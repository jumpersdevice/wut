/*
  ¿wut? : a very simple terminal-based chat application runing on top of IPFS, tweetnacl-js & blessed

  Author: David Dahl <ddahl@nulltxt.se>
*/

'use strict';

const IPFS = require('ipfs');
const Room = require('ipfs-pubsub-room');
// const wrtc = require('wrtc');
// const WStar = require('libp2p-webrtc-star');
// const wstar = new WStar({ wrtc });

const all = require('it-all');

const { v4: uuidv4 } = require('uuid');

const { box } = require('tweetnacl');

const { dmUI } = require('./lib/dm-ui');
const { MainUI } = require('./lib/main-ui');
const { Network } = require('./lib/network');
const {
  openDirectMessage,
  convertObjectToUint8
} = require('./lib/messages');
const { logger } = require('./lib/logger');
const {
  DEFAULT_TOPIC,
  APP_TITLE,
  PEER_REFRESH_MS,
  HOME_DIR,
} = require('./lib/config');

var configuration = {
  handle: null,
  bio: 'Web 3.0 Enthusiast',
  homepage: 'https://github.com/daviddahl/wut',
  myTopic: uuidv4(),
  sharedKey: null,
  keyPair: null,
  peerProfiles: {},
};

const e2eMessages = {};

const uiConfiguration = {
  style: {
    fg: 'blue',
    bg: null,
    border: {
      fg: '#f0f0f0'
    }
  }
};

const storage = {
  e2eMessages: e2eMessages,
  uiConfiguration: uiConfiguration,
  configuration: configuration,
  topic: DEFAULT_TOPIC,
};

async function main () {

  let ipfsRepoPath = `${HOME_DIR}/`;
  // create and expose main UI
  let _keyPair = box.keyPair();
  let pk = convertObjectToUint8(_keyPair.publicKey);
  let sk = convertObjectToUint8(_keyPair.secretKey);

  configuration.keyPair = { publicKey: pk, secretKey: sk };

  const node = await IPFS.create();
  const version = await node.version();
  const nodeId = await node.id();
  const room = new Room(node, DEFAULT_TOPIC);

  const Libp2p = require('libp2p');
  const Gossipsub = require('libp2p-gossipsub');
  const { Buffer } = require('buffer');
  const TCP = require('libp2p-tcp');
  const Mplex = require('libp2p-mplex');
  const SECIO = require('libp2p-secio');
  const PeerInfo = require('peer-info');
  const WebSockets = require('libp2p-websockets');
  const Bootstrap = require('libp2p-bootstrap');

  const bootstrapMultiaddrs = [
    '/dns4/ams-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLer265NRgSp2LA3dPaeykiS1J6DifTC88f5uVQKNAd',
    '/dns4/lon-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLMeWqB7YGVLJN3pNLQpmmEk35v6wYtsMGLzSr5QBU3'
  ];

  const room2 = async () => {
    const node = await Libp2p.create({
      modules: {
        transport: [ TCP, WebSockets ],
        streamMuxer: [ Mplex ],
        connEncryption: [ SECIO ],
        peerDiscovery: [Bootstrap],
        // we add the Pubsub module we want
        // pubsub: Gossipsub
      },
      config: {
        peerDiscovery: {
          autoDial: true, // Auto connect to discovered peers (limited by ConnectionManager minPeers)
          // The `tag` property will be searched when creating the instance of your Peer Discovery service.
          // The associated object, will be passed to the service when it is instantiated.
          [Bootstrap.tag]: {
            enabled: true,
            list: bootstrapMultiaddrs // provide array of multiaddrs
          }
        }
      }
    });

    await node.start();

    return node;
  };

  const network = new Network(configuration, nodeId, room, room2);
  const mainUI = MainUI(configuration, storage, network);

  const output = mainUI.output;
  const input = mainUI.input;
  const peersList = mainUI.peersList;
  const screen = mainUI.screen;

  // TODO: Display public key as QR CODE
  output.log(`Your NaCl public key is: \n    ${configuration.keyPair.publicKey}\n`);
  input.focus();

  output.log('IPFS node is initialized!');
  output.log('IPFS Version:', version.version);
  output.log('IPFS Node Id:', nodeId.id);

  configuration.handle = nodeId.id;

  output.log('\n...........................................');
  output.log('................... Welcome ...............');
  output.log('................... To ....................');
  output.log(`.................. ${APP_TITLE} ..................`);
  output.log('...........................................\n');
  output.log('\n\n*** This is the LOBBY. It is *plaintext* group chat ***');
  output.log('\n*** Type "/help" for help ***\n');

  network.pubsubEmitter.on('subscribed', () => {
    output.log(arguments);
  });

  network.pubsubEmitter.on('message', () => {
    output.log(arguments);
  });

  network.room.on('subscribed', () => {
    output.log(`Now connected to room: ${DEFAULT_TOPIC}`);
  });

  network.room.on('peer joined', (peer) => {
    output.log(`Peer joined the room: ${peer}`);
    if (peer == nodeId.id) {
      if (!configuration.handle) {
        // set default for now
        configuration.handle = nodeId.id;
      }
      // Its YOU!
      network.broadcastProfile();
    }
  });

  network.room.on('peer left', (peer) => {
    output.log(`Peer left: ${peer}`);
  });

  const DIRECT_MSG = 'dm';
  const PROFILE_MSG = 'profile';
  const BROADCAST_MSG = 'brodcast';

  network.room.on('message', (message) => {
    let msg;

    try {
      msg = JSON.parse(message.data); // a2c??? UTF8Encode
    } catch (ex) {
      return output.log(`Error: Cannot parse badly-formed command.`);
    }

    if (msg.messageType) {
      if (msg.messageType == PROFILE_MSG) {
        // update peerprofile:
        configuration.peerProfiles[message.from] = {
          id: message.from,
          handle: msg.handle.trim(),
          bio: msg.bio,
          publicKey: convertObjectToUint8(msg.publicKey),
        };
        return output.log(`*** Profile broadcast: ${message.from} is now ${msg.handle}`);
      } else if (msg.messageType == DIRECT_MSG) {
        return handleDirectMessage(message.from, msg);
      } else if (msg.messageType == BROADCAST_MSG) {
        return output.log(`*** Broadcast: ${message.from}: ${msg.content}`);
      }
    }

    // Handle peer refresh request
    if (message.data == 'peer-refresh') {
      network.broadcastProfile(message.from);
    }

    return output.log(`${message.from}: ${message.data}`);
  });

  const handleDirectMessage = (fromCID, msg) => {
    let ui;

    // Check for existing dmUI
    try {
      ui = e2eMessages[fromCID].ui;
    } catch (ex) {
      // establish the UI, accept first message
      // TODO: whitelisting of publicKeys
      let profile = configuration.peerProfiles[fromCID];
      ui = dmUI(screen, profile, storage, network);

      e2eMessages[fromCID] = {ui: ui};
    }

    try {
      let plaintext = openDirectMessage(msg, configuration);
      if (plaintext == null) {
        ui.output.log(`*** ${APP_TITLE}: Error: Message is null.`);
      } else {
        ui.output.log(`${msg.fromHandle}: ${plaintext}`);
      }
    } catch (ex) {
      ui.output.log(`***`);
      ui.output.log(`*** ${APP_TITLE}: Cannot decrypt messages from ${msg.handle}`);
      logger.error(`${ex} ... \n ${ex.stack}`);
      ui.output.log(`***`);
      return;
    }
  };

  let peers = network.getPeers();
  configuration.peers = [peers];
  if (peers.length) {
    peersList.setData(configuration.peers);
    screen.render();
  }

  let interval = setInterval(() => {
    let peers = network.getPeers();
    configuration.peers = [peers];
    if (peers.length) {
      peersList.setData(configuration.peers);
      screen.render();
    }
  }, PEER_REFRESH_MS);

}

// process.on('uncaughtException', (error) => {
//   logger.error(error);
// });

main();
