# YAWW - Yet Another WebRTC Wrapper
Let's face it: WebRTC is complicated. There's lots of strange terminology, cross browser quirks, and networking combinations that need to be handled. There's also a ton of libraries out there that attempt to make WebRTC simpler, but none of them quite meet my needs. Most of them are either unmaintained since 2016 (a long time), locked into some SaaS, or just poorly documented. While YAWW isn't perfect, it's my WebRTC library and it works for me. If it's what you need as well, great!

## How WebRTC Works
There are definitely people more qualified to do this, but I'll give it a go...

Let's say you have two users, A and B, and they want to connect over WebRTC.

A: Creates an offer and sends it to B. Since the WebRTC connection is not yet established, this exchange must go through an external server known as a signaling server. The offer includes information about A's internet connection, usually including A's IP address or an equivalent identifier.

B: Receives and applies the offer, and generates an answer to send back to A. An answer serves the same function as an offer, it just goes the other way.

A: Receives and applies the answer.

Now both A and B know where each other are on the Internet, but they don't know how to send information back and forth. While the exchange of offers and answers is going on, A and B also generate ICE candidates, which are basically possible paths for data to travel between A and B. ICE candidates may also contain the device's media capabilities, such as supported formats and codecs.

A and B then send their ICE candidates to each other, beginning the negotiation process. A and B's browsers figure out which ICE candidate (if any) produces the most efficient path.

Once the negotiation process is done, A and B may communicate over WebRTC, and the signaling server is no longer needed.

## Installation
Do I really need to tell you how to do this?

Clone or download this repository (or just `/src/yaww.js`), put it somewhere, and include it using a `<script>` tag:
```html
<script src="./src/yaww.js"></script>
```

At the moment, YAWW isn't in any major public CDN.

## Usage
A single connection is represented by a `Connection` object, basically the YAWW equivalent of `RTCPeerConnection`.
```js
const conn = new Connection();
```
This creates a `Connection` with the default configuration. See [the documentation](https://github.com/kyleplo/yaww/wiki/Connection) for all configuration options.

Once you have a `Connection` object, it is recommended that you register event listeners and create channels and streams first, **before** you begin signaling.
```js
conn.addEventListener(..., e => {
    ...
});
const dat = conn.createDataChannel();
```

Once you are ready, call `Connection.init()`, which creates the underlying `RTCPeerConnection`. Unlike `RTCPeerConnection`, `Connection` objects can be reused by calling `Connection.init()` again.

Then, you can begin the signaling process.
```js
conn.init();

// create the offer on one end
const offer = await conn.offer();

// you will need to handle sending the offer
// receive the offer and generate an answer on the other end
const answer = await conn.receiveOffer(offer);

// you will need to handle sending the answer
// receive the answer
await conn.receiveAnswer(answer);
```
And negotiation...
```js
// do this part before calling `Connection.init()`
conn.addEventListener("icecandidate", e => {
    const candidate = e.candidate;
    // you will need to handle sending the ice candidate
});

// receive an ice candidate
conn.receiveIceCandidate(candidate);
```
And if all goes well, the connection should be made, and you'll be able to make use of data channels and streams.
```js
// send to the other client
dat.send("hello");

// receive a message
dat.addEventListener("message", e => {
    const msg = e.message;
});
```
See [the full documentation](https://github.com/kyleplo/yaww/wiki/Connection) for descriptions of all YAWW features.

## Demos
See [the demos folder](https://github.com/kyleplo/yaww/tree/main/demos) for demo code.

The `text` and `video` demos can be opened directly in the browser, without a signaling server. You'll copy and paste the signaling information manually.

The `text-signaled` and `video-signaled` demos include a simple signaling server written in Node.js using WebSockets. You'll need to run that server, but the pages themselves don't need a server.

Note that the demos that use video require a secure context. This includes `file:` and `localhost:` in most browsers, but won't work across devices using just your IP address, unless you either set up an SSL certificate or use a forwarding/tunneling server.

## Maintenance
I'm planning on using YAWW in a number of personal projects, so I'm probably discover some bugs along the way.

If you find anything, report it using Github's issues feature and I'll try to help but don't expect too much. If you can fix it yourself, fork it and make a pull request.
