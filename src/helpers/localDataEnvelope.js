const fs = require("fs");
const path = require("path");
const secretCrypto = require("./secretCrypto");

const MAGIC = Buffer.from("VLAB-DATA\0V1\0", "utf8");

class LocalDataEnvelope {
  constructor(databasePath, cryptoProvider = secretCrypto) {
    this.databasePath = databasePath;
    this.envelopePath = `${databasePath}.enc`;
    this.cryptoProvider = cryptoProvider;
  }

  restore() {
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.databasePath)) {
      fs.chmodSync(this.databasePath, 0o600);
      return { restored: false, legacyPlaintext: true };
    }
    if (!fs.existsSync(this.envelopePath)) return { restored: false, legacyPlaintext: false };

    const envelope = fs.readFileSync(this.envelopePath);
    if (
      envelope.length <= MAGIC.length
      || !envelope.subarray(0, MAGIC.length).equals(MAGIC)
    ) {
      throw new Error("Local data envelope has an unsupported magic or version");
    }
    const plaintext = this.cryptoProvider.decryptBuffer(envelope.subarray(MAGIC.length));
    const temporary = `${this.databasePath}.restore-${process.pid}`;
    fs.writeFileSync(temporary, plaintext, { mode: 0o600 });
    fs.renameSync(temporary, this.databasePath);
    fs.chmodSync(this.databasePath, 0o600);
    return { restored: true, legacyPlaintext: false };
  }

  seal(database = null) {
    if (database?.open !== false) {
      database?.pragma?.("wal_checkpoint(TRUNCATE)");
      database?.close?.();
    }
    if (!fs.existsSync(this.databasePath)) return { sealed: false };
    if (!this.cryptoProvider.isAvailable()) {
      throw new Error("OS-backed encryption is unavailable; plaintext database retained");
    }

    const encrypted = this.cryptoProvider.encryptBuffer(fs.readFileSync(this.databasePath));
    const temporary = `${this.envelopePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, Buffer.concat([MAGIC, encrypted]), { mode: 0o600 });
    fs.renameSync(temporary, this.envelopePath);
    fs.chmodSync(this.envelopePath, 0o600);
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${this.databasePath}${suffix}`, { force: true });
    }
    return { sealed: true };
  }

  destroy() {
    for (const target of [
      this.databasePath,
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`,
      this.envelopePath,
    ]) {
      fs.rmSync(target, { force: true });
    }
  }
}

module.exports = { LocalDataEnvelope, MAGIC };
