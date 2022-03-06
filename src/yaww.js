class NullEvent extends Event {
    constructor () {
        super("null");
    }
}

class ConnectionStateChangeEvent extends Event {
    constructor (connectionState, reason, target) {
        super("connectionstatechange");

        if(connectionState === target._lastConnectionStateChangeValue){
            return new NullEvent();
        }else{
            target._lastConnectionStateChangeValue = connectionState;
        }
        this.connectionState = connectionState;
        this.reason = reason;
    }
}

class SignalingStateChangeEvent extends Event {
    constructor (signalingState, reason, target) {
        super("signalingstatechange");
        if(signalingState === target._lastSignalingStateChangeValue){
            return new NullEvent();
        }else{
            target._lastSignalingStateChangeValue = signalingState;
        }
        this.signalingState = signalingState;
        this.reason = reason;
    }
}

class MessageEvent extends Event {
    constructor (message) {
        super("message");
        this.message = message;
    }
}

class CandidateDiscoveredEvent extends Event {
    constructor (candidate) {
        super("candidatediscovered");
        this.candidate = candidate;
    }
}

class AllCandidatesDiscoveredEvent extends Event {
    constructor (candidates) {
        super("allcandidatesdiscovered");
        this.candidates = candidates;
    }
}

class DataChannelEvent extends Event {
    constructor (channel, remote) {
        super("datachannel");
        this.channel = channel;
        this.remote = remote;
    }
}

class NegotiateEvent extends Event {
    constructor () {
        super("negotiate", {cancelable: true});
    }
}

class StreamAddedEvent extends Event {
    constructor (stream) {
        super("streamadded");
        this.stream = stream;
    }
}

class AnswerEvent extends Event {
    constructor (answer) {
        super("answer");
        this.answer = answer;
    }
}

class OfferEvent extends Event {
    constructor (offer) {
        super("offer");
        this.offer = offer;
    }
}

class PingChangeEvent extends Event {
    constructor (ping) {
        super("pingchange");
        this.ping = ping;
    }
}

class IceCandidateErrorEvent extends Event {
    constructor (error) {
        super("icecandidateerror");
        this.address = error.address || null;
        this.errorCode = error.errorCode || null;
        this.errorText = error.errorText || null;
        this.port = error.port || null;
        this.url = error.url || null;
    }
}

class DataChannel extends EventTarget {
    constructor (dataChannel, remote) {
        super();
        this._dat = dataChannel;
        this.label = dataChannel.label;
        this.remote = remote;
        this.connectionState = "closed";
        this._lastConnectionStateChangeValue = "";

        this._dat.addEventListener("message", e => {
            super.dispatchEvent(new MessageEvent(e.data));
        });
        this._dat.addEventListener("open", () => {
            this.connectionState = "open";
            super.dispatchEvent(new ConnectionStateChangeEvent("open", "opened", this));
        });
        this._dat.addEventListener("close", () => {
            this.connectionState = "closed";
            super.dispatchEvent(new ConnectionStateChangeEvent("closed", "closed", this));
        });
    }

    send (message) {
        if(this.connectionState !== "open"){
            throw Connection._libName + "Error: Data channel not open."
        }

        this._dat.send(message);
    }

    close (_s) {
        if(this.connectionState !== "open"){
            if(_s){
                return;
            }
            throw Connection._libName + "Error: Data channel not open."
        }

        this._dat.close();
    }
}

class Connection extends EventTarget {
    constructor (config) {
        super();
        this.signalingState = "closed";
        this._config = Object.assign({
            rtc: {},
            pingInterval: 1000,
            disconnectTimeout: 1500
        }, config);
        this.ping = null;
        this._disconnectTimer = null;
        this._hasAllCandidates = false;
        this._localInternalChannel = null;
        this._remoteInternalChannel = null;
        this._lastPing = null;
        this._candidates = [];
        this._queuedCandidates = [];
        this._lastSignalingStateChangeValue = "";
    }

    static _libName = "YAWW"

    static _signalingStates = {
        "closed": {
            state: "closed",
            reason: "disconnected"
        },
        "have-local-offer": {
            state: "awaiting-answer",
            reason: "local-description-received"
        },
        "have-remote-offer": {
            state: "negotiating",
            reason: "remote-description-received"
        },
        "have-local-pranswer": {
            state: "closed",
            reason: "legacy-signaling"
        },
        "have-remote-pranswer": {
            state: "closed",
            reason: "legacy-signaling"
        }
    }

    static generateRandomId () {
        return Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(-6);
    }

    static _fixSessionDescription(desc){
        if(desc instanceof RTCSessionDescription){
            return desc;
        }else{
            return new RTCSessionDescription(desc);
        }
    }

    static _fixIceCandidate(candidate){
        if(candidate instanceof RTCIceCandidate){
            return candidate;
        }else{
            return new RTCIceCandidate(candidate);
        }
    }

    init () {
        if(this.signalingState !== "closed"){
            throw Connection._libName + "Error: Connection already open.";
        }

        this._rtc = new RTCPeerConnection(this._config.rtc);
        this._rtc.addEventListener("icecandidate", e => {
            if(e.candidate){
                this._candidates.push(e.candidate);
                super.dispatchEvent(new CandidateDiscoveredEvent(e.candidate));
            }else if(!this._hasAllCandidates){
                super.dispatchEvent(new AllCandidatesDiscoveredEvent(this._candidates));
                this._hasAllCandidates = true;
            }
        });
        this._rtc.addEventListener("datachannel", e => {
            if(e.channel.label.startsWith(Connection._libName + "-")){
                if(this._remoteInternalChannel){
                    throw Connection._libName + "Error: Multiple remote internal channels received."
                };
                this._remoteInternalChannel = e.channel;
                this._remoteInternalChannel.addEventListener("open", () => {
                    super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "remote-internal-opened", this));
                })
                this._remoteInternalChannel.addEventListener("message", e => {
                    e.target.send("pong");
                });
                this._remoteInternalChannel.addEventListener("close", () => {
                    this._remoteInternalChannel = null;
                    super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "remote-internal-closed", this));
                    this.close(true);
                });
            }else{
                super.dispatchEvent(new DataChannelEvent(new DataChannel(e.channel, true), true));
            }
        });
        this._rtc.addEventListener("negotiationneeded", () => {
            if(!super.dispatchEvent(new NegotiateEvent()) && this._rtc && this._rtc.currentLocalDescription){
                this._candidates = [];
                this._hasAllCandidates = false;
                this.offer(true);
            }
        });
        this._rtc.addEventListener("track", e => {
            if(e.streams.length){
                e.streams.forEach(s => {
                    super.dispatchEvent(new StreamAddedEvent(s));
                });
            }else{
                super.dispatchEvent(new StreamAddedEvent(new MediaStream([e.track])));
            }
        });
        this._rtc.addEventListener("iceconnectionstatechange", () => {
            if(!this._rtc){
                return;
            }
            if(this._rtc.iceConnectionState === "connected" || this._rtc.iceConnectionState === "complete"){
                if(this._rtc.iceConnectionState === "complete" && !this._hasAllCandidates){
                    super.dispatchEvent(new AllCandidatesDiscoveredEvent(this._candidates));
                    this._hasAllCandidates = true;
                }
                if(!this._localInternalChannel){
                    this._initLocalInternalChannel();
                }
                this.signalingState = "complete";
                this._useQueuedCandidates();
                super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "negotiation-finished", this));
            }else if(this._rtc.iceConnectionState === "failed"){
                this.signalingState = "closed"
                super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "ice-failed", this));
                this.close(true);
            }else if(this._rtc.iceConnectionState === "closed" || this._rtc.iceConnectionState === "disconnected"){
                this.close(true);
            }
        });
        this._rtc.addEventListener("signalingstatechange", () => {
            if(!this._rtc){
                this.signalingState = "closed";
                super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "disconnected", this));
                return;
            }
            var reason;
            if(this._rtc.signalingState === "stable"){
                if(this._rtc.iceConnectionState === "completed" || this._rtc.iceConnectionState == "connected"){
                    this.signalingState = "complete";
                    this._useQueuedCandidates();
                    reason = "negotiation-finished"
                }else if(this._rtc.currentLocalDescription){
                    this.signalingState = "negotiating";
                    this._useQueuedCandidates();
                    reason = "negotiating"
                }else{
                    this.signalingState = "awaiting-offer"
                    reason = "signaling-begin"
                }
            }else{
                this.signalingState = Connection._signalingStates[this._rtc.signalingState].state;
                reason = Connection._signalingStates[this._rtc.signalingState].reason;
                if(this.signalingState === "closed"){
                    this.close(true);
                }
                if(this.signalingState === "negotiating"){
                    this._useQueuedCandidates();
                }
            }
            super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, reason, this));
        });
        if("RTCPeerConnectionIceErrorEvent" in window){
            this._rtc.addEventListener("icecandidateerror", e => {
                super.dispatchEvent(new IceCandidateErrorEvent(e));
                console.error("STUN/TURN Server Error:", e);
            });
        }else{
            console.warn("RTCPeerConnectionIceErrorEvent is unsupported, STUN/TURN errors will go undetected.");
        }
        if(!this._localInternalChannel){
            this._initLocalInternalChannel();
        }
        this.signalingState = "awaiting-offer";
        super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "init", this));
    }

    _initLocalInternalChannel () {
        if(this._localInternalChannel){
            throw Connection._libName + "Error: Internal channel already exists."
        }

        this._localInternalChannel = this._rtc.createDataChannel(Connection._libName + "-" + Connection.generateRandomId());
        this._localInternalChannel.addEventListener("open", e => {
            super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "local-internal-opened", this));
            this._lastPing = Date.now();
            e.target.send("ping");
            this._disconnectTimer = setTimeout(() => {
                super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "timeout", this));
                this.close(true);
            }, this._config.disconnectTimeout);
        });
        this._localInternalChannel.addEventListener("message", e => {
            clearTimeout(this._disconnectTimer);
            this.ping = Date.now() - this._lastPing;
            super.dispatchEvent(new PingChangeEvent(this.ping));
            setTimeout(() => {
                if(e.target.readyState === "open"){
                    this._lastPing = Date.now();
                    e.target.send("ping");
                    this._disconnectTimer = setTimeout(() => {
                        super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "timeout", this));
                        this.close(true);
                    }, this._config.disconnectTimeout);
                }else{
                    this.close(true);
                }
            }, this._config.pingInterval);
        });
        this._localInternalChannel.addEventListener("close", () => {
            this._localInternalChannel = null;
            this.ping = null;
            super.dispatchEvent(new PingChangeEvent(this.ping));
            this.signalingState = "closed";
            super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "local-internal-closed", this));
            this.close(true);
        });
    }

    _useQueuedCandidates () {
        if(this.signalingState !== "complete" && this.signalingState !== "negotiating"){
            return;
        }

        this._queuedCandidates.forEach(c => {
            this._rtc.addIceCandidate(c);
        });
        this._queuedCandidates = [];
    }

    addTrack (track, stream) {
        if(!this._rtc){
            throw Connection._libName + "Error: Connection not initialized.";
        }

        return this._rtc.addTrack(track, stream);
    }

    removeTrack (track) {
        if(!this._rtc){
            throw Connection._libName + "Error: Connection not initialized.";
        }

        this._rtc.removeTrack(track);
    }

    addStream (stream) {
        if(!this._rtc){
            throw Connection._libName + "Error: Connection not initialized.";
        }

        var r = [];
        stream.getTracks().forEach(t => {
            r.push(this.addTrack(t, stream));
        });
        return r;
    }

    removeStream (stream) {
        if(!this._rtc){
            throw Connection._libName + "Error: Connection not initialized.";
        }

        var i = [];
        stream.getTracks().forEach(t => {
            i.push(t.id);
        });

        this._rtc.getSenders().forEach(r => {
            if(r.track && i.includes(r.track.id)){
                this._rtc.removeTrack(r);
            }
        });
    }

    async offer (renegotiate) {
        if(renegotiate ? this.signalingState !== "awaiting-offer" : (this.signalingState !== "complete" && this.signalingState !== "awaiting-offer")){
            throw Connection._libName + "Error: Connection generate offer.";
        }else if(!this._rtc){
            throw Connection._libName + "Error: Connection not initialized."
        }
        this.polite = false;

        const o = await this._rtc.createOffer({
            iceRestart: renegotiate
        });
        await this._rtc.setLocalDescription(o);
        super.dispatchEvent(new OfferEvent(o));
        return o;
    }

    async receiveOffer (offer) {
        if(this.signalingState === "closed"){
            throw Connection._libName + "Error: Connection closed.";
        }

        const d = Connection._fixSessionDescription(offer);

        if(d.type !== "offer"){
            throw Connection._libName + "Error: Session description is not of type \"offer\"."
        }

        await this._rtc.setRemoteDescription(d);
        const a = await this._rtc.createAnswer();
        await this._rtc.setLocalDescription(a);
        super.dispatchEvent(new AnswerEvent(a));
        return a;
    }

    async receiveAnswer (answer) {
        if(this.signalingState !== "awaiting-answer" && this.signalingState !== "complete"){
            throw Connection._libName + "Error: Connection cannot accept answer.";
        }

        const d = Connection._fixSessionDescription(answer);

        if(d.type !== "answer"){
            throw Connection._libName + "Error: Session description is not of type \"answer\"."
        }

        await this._rtc.setRemoteDescription(d);
    }

    async receiveIceCandidate (candidate) {
        if(this.signalingState !== "negotiating" && this.signalingState !== "complete"){
            this._queuedCandidates.push(Connection._fixIceCandidate(candidate));``
        }else{
            await this._rtc.addIceCandidate(Connection._fixIceCandidate(candidate));
        }
    }

    createDataChannel (label) {
        if(this.signalingState === "closed"){
            throw Connection._libName + "Error: Connection closed.";
        }

        const d = new DataChannel(this._rtc.createDataChannel(label || Connection.generateRandomId()), false);
        super.dispatchEvent(new DataChannelEvent(d, false));
        return d;
    }

    close (_silent) {
        if(this.signalingState === "closed" && !_silent){
            throw Connection._libName + "Error: Connection already closed.";
        }

        if(this.ping){
            this.ping = null;
            super.dispatchEvent(new PingChangeEvent(this.ping));
        }

        if(this._localInternalChannel && this._localInternalChannel.readyState === "open"){
            this._localInternalChannel.close();
        }

        if(this._remoteInternalChannel && this._remoteInternalChannel.readyState === "open"){
            this._remoteInternalChannel.close();
        }

        if (this._rtc && this.signalingState !== "closed") {
            this._rtc.close();
        }

        this._rtc = null;
        this._localInternalChannel = null;
        this._remoteInternalChannel = null;
        this._candidates = [];
        this._queuedCandidates = [];
        this._hasAllCandidates = false;
        
        this.signalingState = "closed";
        super.dispatchEvent(new SignalingStateChangeEvent(this.signalingState, "closed", this));
    }
}
