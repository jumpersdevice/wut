const fs = require('fs');
const path = require('path');

const { logger } = require('./logger');
const {
  box,
  secretbox,
  randomBytes
} = require('tweetnacl');

const {
  decodeUTF8,
  encodeUTF8,
  encodeBase64,
  decodeBase64
} = require('tweetnacl-util');

const {
  STRING,
  SK_STORAGE_PATH,
  PK_STORAGE_PATH,
  HOME_DIR,
  WUT_HOME
} = require('./config');

const { convertObjectToUint8 } = require('./messages');

class DATA_TYPES {
  PUB_KEY = 'pub'
  SEC_KEY = 'sec'
  NONCE = 'non'
  STRING = 'string'
  OBJECT = 'object'
}

class Keys {
  constructor (init=false) {
    if (init) {
      const kp = this.generateKeypair();
      const pubKey = kp.publicKey;

      try {
        this.keypairToDisk(kp);
        this.pubKeyToDisk(pubKey);
      } catch (ex) {
        console.error(ex);
        console.error(ex.stack);
        logger.error(ex);
        logger.error(ex.stack);
      }
    }
  }

  reverseKeyOps (b64Str, keyType) {
    const str = decodeBase64(b64Str);
    const utf8 = encodeUTF8(str);
    const json = JSON.parse(utf8);
    const result = convertObjectToUint8(json, keyType);
    if (!result) {
      throw new Error('reverseKeyOps failed, null key');
    }

    return result;
  }

  get secretKey () {
    const skB64 = this.readFile('sec');
    console.log(skB64);
    return this.reverseKeyOps(skB64, 'sec');
  }

  get publicKey () {
    const pkB64 = this.readFile('pub');

    return this.reverseKeyOps(pkB64, 'pub');
  }

  readFile (fileName) {
    if (!fileName) {
      throw new Error('fileName arg required');
    }
    let keyPath;
    if (fileName == 'pub') {
      keyPath = PK_STORAGE_PATH;
    } else if (fileName == 'sec') {
      keyPath = SK_STORAGE_PATH;
    } else {
      throw new Error('readfile(): Unknown file');
    }
    console.log('keyPath: ', keyPath);
    try {
      return fs.readFileSync(keyPath, 'utf-8');
    } catch (ex) {
      logger.error(ex);
      logger.error(ex.stack);
      throw new Error(`Cannot get key at path: ${keyPath}`);
    }
  }

  generateKeypair () {
    return box.keyPair();
  }

  pubKeyToString (pubKey) {
    if (!pubKey) {
      throw new Error('Error: pubKey arg required');
    }

    return JSON.stringify(pubKey);
  }

  pubKeyStringToBase64 (pubKeyStr) {
    if (!pubKeyStr && !typeof pubKeyStr == STRING) {
      throw new Error('Error: pubKeyStr arg required');
    }

    return encodeBase64(pubKeyStr);
  }

  pubKeyToDisk (pubKey) {
    const pubStr = this.pubKeyToString(pubKey);
    const pubB64 = this.pubKeyStringToBase64(pubStr);
    const rv = this.persistPubKey(pubB64);

    if (!rv) {
      throw new Error('Could not persist pubKey');
    }

    return rv;
  }

  persistPubKey (pubB64) {
    if (!pubB64 && !typeof pubB64 == STRING) {
      throw new Error('Error: pubB64 arg required');
    }
    // Check for existence first
    if (!fs.existsSync(PK_STORAGE_PATH)) {
      fs.writeFile(PK_STORAGE_PATH, pubB64, (err) => {
        if (err) throw err;
      });
    }

    return true;
  }

  keypairToString (kp) {
    if (!kp && !kp.publicKey && !kp.privateKey) {
      throw new Error('Error: keyPair arg required');
    }

    return JSON.stringify(kp);
  }

  keypairStringToBase64 (kpStr) {
    if (!kpStr && !typeof kpStr == STRING) {
      throw new Error('Error: keyPair arg required');
    }

    return encodeBase64(kpStr);
  }

  keypairToDisk (kp) {
    const kpStr = this.keypairToString(kp);
    const kpB64 = this.keypairStringToBase64(kpStr);
    const rv = this.persistKeypair(kpB64);

    if (!rv) {
      throw new Error('Could not persist keypair');
    }

    return rv;
  }

  persistKeypair (kpB64) {
    if (!kpB64 && !typeof kpB64 == STRING) {
      throw new Error('Error: kpB64 arg required');
    }
    // Check for existence first
    if (!fs.existsSync(WUT_HOME)) {
      this.createAppHome();
    }

    fs.writeFile(SK_STORAGE_PATH, kpB64, (err) => {
      if (err) throw err;
    });

    return true;
  }

  createAppHome () {
    fs.mkdirSync(WUT_HOME);
  }
}

module.exports = {
  Keys: Keys,
};
