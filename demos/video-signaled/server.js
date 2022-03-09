const ws = require("ws");
const wss = new ws.Server({port: 7071});

var connections = {};

wss.on("connection", s => {
    const randomId = Date.now().toString(36).slice(-3) + Math.random().toString(36).slice(-3);
    connections[randomId] = {
        id: randomId,
        socket: s,
        candidates: [],
        sdp: "",
        peer: ""
    }
    s.send(JSON.stringify({
        type: "id",
        data: randomId
    }));

    s.on("message", ms => {
        const m = JSON.parse(ms);
        if(m.type === "iceCandidate"){
           if(connections[randomId].peer){
               connections[connections[randomId].peer].socket.send(JSON.stringify({
                   type: "iceCandidate",
                   data: m.data
               }));
           }else{
               connections[randomId].candidates.push(m.data);
           }
        }else if(m.type === "join"){
            if(connections[m.data] && !connections[m.data].peer){
                connections[randomId].peer = m.data;
                connections[m.data].peer = randomId;

                if(connections[randomId].candidates){
                    connections[randomId].candidates.forEach(c => {
                        connections[m.data].socket.send(JSON.stringify({
                            type: "iceCandidate",
                            data: c
                        }))
                    });
                    connections[randomId].candidates = [];
                }
                if(connections[randomId].sdp){
                    connections[m.data].socket.send(JSON.stringify({
                        type: "sdp",
                        data: connections[randomId].sdp
                    }));
                    connections[randomId].sdp = "";
                }

                if(connections[m.data].candidates){
                    connections[m.data].candidates.forEach(c => {
                        connections[randomId].socket.send(JSON.stringify({
                            type: "iceCandidate",
                            data: c
                        }))
                    });
                    connections[m.data].candidates = [];
                }
                if(connections[m.data].sdp){
                    connections[randomId].socket.send(JSON.stringify({
                        type: "sdp",
                        data: connections[m.data].sdp
                    }));
                    connections[m.data].sdp = "";
                }
            }
        }else if(m.type === "sdp"){
            if(connections[randomId].peer){
                connections[connections[randomId].peer].socket.send(JSON.stringify({
                    type: "sdp",
                    data: m.data
                }))
            }else{
                connections[randomId].sdp = m.data;
            }
        }
    });

    s.on("close", () => {
        if(connections[randomId].peer){
            const peer = connections[connections[randomId].peer];
            peer.peer = "";
            peer.candidates = [];
            peer.sdp = "";
        }
        delete connections[randomId];
    });
});