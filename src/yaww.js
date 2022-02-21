class ConnectionStateChangeEvent extends Event {
    constructor (v) {
        super("connectionstatechange");
        this.connectionState = v;
    }
}

class MessageEvent extends Event {
    constructor (v) {
        super("message");
        this.message = v;
    }
}

class CandidateDiscoveredEvent extends Event {
    constructor (v) {
        super("candidatediscovered");
        this.candidate = v;
    }
}

class AllCandidatesDiscoveredEvent extends Event {
    constructor (v) {
        super("allcandidatesdiscovered");
        this.candidates = v;
    }
}

class DataChannelEvent extends Event {
    constructor (v, r) {
        super("datachannel");
        this.channel = v;
        this.remote = r;
    }
}

class NegotiateEvent extends Event {
    constructor (v) {
        super("negotiate", {cancelable: true});
    }
}

class StreamAddedEvent extends Event {
    constructor (v) {
        super("streamadded");
        this.stream = v;
    }
}

class AnswerEvent extends Event {
    constructor (v) {
        super("answer");
        this.answer = v;
    }
}

class OfferEvent extends Event {
    constructor (v) {
        super("offer");
        this.offer = v;
    }
}

class PingChangeEvent extends Event {
    constructor (v) {
        super("pingchange");
        this.ping = v;
    }
}

class IceCandidateErrorEvent extends Event {
    constructor (v) {
        super("icecandidateerror");
        this.address = v.address || null;
        this.errorCode = v.errorCode || null;
        this.errorText = v.errorText || null;
        this.port = v.port || null;
        this.url = v.url || null;
    }
}

class DataChannel extends EventTarget {
    constructor (d, p) {
        super();
        this._dat = d;
        this._parentConnection = p;
        this.connectionState = "closed";
        this.label = d.label;

        this._dat.addEventListener("message", e => {
            super.dispatchEvent(new MessageEvent(e.data));
        });
        this._dat.addEventListener("open", () => {
            this.connectionState = "open";
            super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
        });
        this._dat.addEventListener("close", () => {
            this.connectionState = "closed";
            super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
            this._parentConnection.close(true);
        });
        this._dat.addEventListener("error", e => {
            this.close();
        });
    }

    send (d) {
        if(this.connectionState !== "open"){
            throw "YAWWError: Data channel not open."
        }

        this._dat.send(d);
    }

    close () {
        if(this.connectionState !== "open"){
            throw "YAWWError: Data channel not open."
        }

        this._dat.close();
    }
}

class Connection extends EventTarget {
    constructor (c) {
        super();
        this.connectionState = "closed";
        this._config = Object.assign({
            rtc: {},
            pingInterval: 1000,
            disconnectTimeout: 1500
        }, c);
        this.ping = null;
        this._disconnectTimer = null;
        this._hasAllCandidates = false;
        this._localPingChannel = null;
        this._remotePingChannel = null;
        this._lastPing = null;
        this._candidates = [];
        this._queuedCandidates = [];
    }

    static _signalingStates = {
        "closed": "closed",
        "have-local-offer": "awaiting-answer",
        "have-remote-offer": "negotiating",
        "have-local-pranswer": "negotiating",
        "have-remote-pranswer": "negotiating"
    }

    static generateRandomId () {
        return Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(-6);
    }

    init () {
        if(this.connectionState !== "closed"){
            throw "YAWWError: Connection already open.";
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
            if(e.channel.label.startsWith("ping-")){
                if(this._remotePingChannel){
                    throw "YAWWError: Multiple remote ping channels received."
                }
                this._remotePingChannel = e.channel;
                this._remotePingChannel.addEventListener("message", e => {
                    e.target.send("pong");
                });
                this._remotePingChannel.addEventListener("close", () => {
                    this._remotePingChannel = null;
                    this.close(true);
                });
                this._remotePingChannel.addEventListener("error", e => {
                    if(e.target.readyState !== "closing" && e.target.readyState !== "closed"){
                        e.target.close();
                    }
                    this._remotePingChannel = null;
                });
            }else{
                super.dispatchEvent(new DataChannelEvent(new DataChannel(e.channel, this), true));
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
            if(this._rtc.iceConnectionState === "connected" || this._rtc.iceConnectionState === "complete"){
                if(this._rtc.iceConnectionState === "complete" && !this._hasAllCandidates){
                    super.dispatchEvent(new AllCandidatesDiscoveredEvent(this._candidates));
                    this._hasAllCandidates = true;
                }
                if(!this._localPingChannel){
                    this._setupPingChannel();
                }
                this._useQueuedCandidates();
                if(this.connectionState === "connected"){
                    return;
                }
                this.connectionState = "connected";
                super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
            }else if(this._rtc.iceConnectionState === "failed"){
                if(this.connectionState === "ice-failed"){
                    return;
                }
                this.connectionState = "ice-failed"
                super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
            }else if(this._rtc.iceConnectionState === "closed" || this._rtc.iceConnectionState === "disconnected"){
                this.close(true);
            }
        });
        this._rtc.addEventListener("signalingstatechange", () => {
            if(!this._rtc){
                if(this.connectionState !== "closed"){
                    this.connectionState = "closed";
                    super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
                }
                return;
            }
            if(this._rtc.signalingState === "stable"){
                if(this._rtc.iceConnectionState === "completed" || this._rtc.iceConnectionState == "connected"){
                    this._useQueuedCandidates();
                    if(this.connectionState === "connected"){
                        return;
                    }
                    this.connectionState = "connected";
                }else if(this._rtc.currentLocalDescription){
                    if(this.connectionState === "negotiating"){
                        return;
                    }
                    this.connectionState = "negotiating";
                    this._useQueuedCandidates();
                }else{
                    if(this.connectionState === "awaiting-offer"){
                        return;
                    }
                    this.connectionState = "awaiting-offer"
                }
            }else{
                if(this.connectionState === Connection._signalingStates[this._rtc.signalingState]){
                    return;
                }
                this.connectionState = Connection._signalingStates[this._rtc.signalingState];
                if(this.connectionState === "closed"){
                    this.close(true);
                }
                if(this.connectionState === "negotiating"){
                    this._useQueuedCandidates();
                }
            }
            super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
        });
        if("RTCPeerConnectionIceErrorEvent" in window){
            this._rtc.addEventListener("icecandidateerror", e => {
                super.dispatchEvent(new IceCandidateErrorEvent(e));
                console.error("STUN/TURN Server Error:", e);
            });
        }else{
            console.warn("RTCPeerConnectionIceErrorEvent is unsupported, STUN/TURN errors will go undetected.");
        }
        if(!this._localPingChannel){
            this._setupPingChannel();
        }
        if(this.connectionState === "awaiting-offer"){
            return;
        }
        this.connectionState = "awaiting-offer";
        super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
    }

    _setupPingChannel () {
        if(this._localPingChannel){
            throw "YAWWError: Ping channel already exists."
        }

        this._localPingChannel = this._rtc.createDataChannel("ping-" + Connection.generateRandomId());
        this._localPingChannel.addEventListener("open", e => {
            this._lastPing = Date.now();
            e.target.send("ping");
            this._disconnectTimer = setTimeout(() => {
                this.close(true);
            }, this._config.disconnectTimeout);
        });
        this._localPingChannel.addEventListener("message", e => {
            clearTimeout(this._disconnectTimer);
            this.ping = Date.now() - this._lastPing;
            super.dispatchEvent(new PingChangeEvent(this.ping));
            setTimeout(() => {
                if(e.target.readyState === "open"){
                    this._lastPing = Date.now();
                    e.target.send("ping");
                    this._disconnectTimer = setTimeout(() => {
                        this.close(true);
                    }, this._config.disconnectTimeout);
                }else{
                    this.close(true);
                }
            }, this._config.pingInterval);
        });
        this._localPingChannel.addEventListener("close", () => {
            this._localPingChannel = null;
            this.ping = null;
            super.dispatchEvent(new PingChangeEvent(this.ping));
            this.close(true);
        });
        this._localPingChannel.addEventListener("error", e => {
            if(e.target.readyState !== "closing" && e.target.readyState !== "closed"){
                e.target.close();
            }
            this._localPingChannel = null;
        });
    }

    _useQueuedCandidates () {
        if(this.connectionState !== "connected" && this.connectionState !== "negotiating"){
            throw "YAWWError: Connection cannot accept ice candidates"
        }

        this._queuedCandidates.forEach(c => {
            this._rtc.addIceCandidate(c);
        });
        this._queuedCandidates = [];
    }

    addTrack (t, s) {
        if(!this._rtc){
            throw "YAWWError: Connection not initialized.";
        }

        return this._rtc.addTrack(t, s);
    }

    removeTrack (t) {
        if(!this._rtc){
            throw "YAWWError: Connection not initialized.";
        }

        this._rtc.removeTrack(t);
    }

    addStream (s) {
        if(!this._rtc){
            throw "YAWWError: Connection not initialized.";
        }

        var r = [];
        s.getTracks().forEach(t => {
            r.push(this.addTrack(t, s));
        });
        return r;
    }

    removeStream (s) {
        if(!this._rtc){
            throw "YAWWError: Connection not initialized.";
        }

        var i = [];
        s.getTracks().forEach(t => {
            i.push(t.id);
        });

        this._rtc.getSenders().forEach(r => {
            if(r.track && i.includes(r.track.id)){
                this._rtc.removeTrack(r);
            }
        });
    }

    async offer (n) {
        if(this.connectionState !== "awaiting-offer" && !n){
            throw "YAWWError: Connection generate offer.";
        }else if(!this._rtc){
            throw "YAWWError: Connection not initialized."
        }

        const o = await this._rtc.createOffer({
            iceRestart: n
        });
        await this._rtc.setLocalDescription(o);
        super.dispatchEvent(new OfferEvent(o));
        return o;
    }

    async receiveOffer (o) {
        if(this.connectionState === "closed"){
            throw "YAWWError: Connection closed.";
        }

        await this._rtc.setRemoteDescription(new RTCSessionDescription(o));
        const a = await this._rtc.createAnswer();
        await this._rtc.setLocalDescription(a);
        super.dispatchEvent(new AnswerEvent(a));
        return a;
    }

    async receiveAnswer (a) {
        if(this.connectionState !== "awaiting-answer"){
            throw "YAWWError: Connection cannot accept answer.";
        }

        await this._rtc.setRemoteDescription(a);
    }

    async receiveIceCandidate (c) {
        if(this.connectionState !== "negotiating" && this.connectionState !== "connected"){
            this._queuedCandidates.push(new RTCIceCandidate(c));``
        }else{
            await this._rtc.addIceCandidate(new RTCIceCandidate(c));
        }
    }

    createDataChannel (l) {
        if(this.connectionState === "closed"){
            throw "YAWWError: Connection closed.";
        }

        const d = new DataChannel(this._rtc.createDataChannel(l || Connection.generateRandomId()), this);
        super.dispatchEvent(new DataChannelEvent(d, false));
        return d;
    }

    close (_s) {
        if(this.connectionState === "closed" && !_s){
            throw "YAWWError: Connection already closed.";
        }

        if(this.ping){
            this.ping = null;
            super.dispatchEvent(new PingChangeEvent(this.ping));
        }

        if(this._localPingChannel && this._localPingChannel.readyState === "open"){
            this._localPingChannel.close();
        }

        if(this._remotePingChannel && this._remotePingChannel.readyState === "open"){
            this._remotePingChannel.close();
        }

        if (this._rtc && this.connectionState !== "closed") {
            this._rtc.close();
        }

        this._rtc = null;
        this._localPingChannel = null;
        this._remotePingChannel = null;
        this._candidates = [];
        this._queuedCandidates = [];
        this._hasAllCandidates = false;
        
        if(this.connectionState !== "closed"){
            this.connectionState = "closed";
            super.dispatchEvent(new ConnectionStateChangeEvent(this.connectionState));
        }
    }
}
