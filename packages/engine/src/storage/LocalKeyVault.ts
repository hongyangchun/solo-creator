import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class LocalKeyVault {
  private vaultPath: string;
  private masterKey: Buffer;

  constructor(baseDir: string = path.join(process.env.HOME || '.', '.solo-creator')) {
    this.vaultPath = path.join(baseDir, 'vault.enc');
    // 基于机器特征派生本地主密钥
    const machineFingerprint = `${process.env.USER || 'user'}:${process.arch}:${process.platform}`;
    this.masterKey = crypto.pbkdf2Sync(machineFingerprint, 'solo-creator-salt-2026', 100000, 32, 'sha256');
  }

  setSecret(key: string, secretValue: string): void {
    const secrets = this.loadAllSecrets();
    secrets[key] = secretValue;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(JSON.stringify(secrets), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const payload = JSON.stringify({
      iv: iv.toString('hex'),
      authTag,
      data: encrypted
    });

    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
    fs.writeFileSync(this.vaultPath, payload, 'utf8');
  }

  getSecret(key: string): string | null {
    const secrets = this.loadAllSecrets();
    return secrets[key] || null;
  }

  private loadAllSecrets(): Record<string, string> {
    if (!fs.existsSync(this.vaultPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      const { iv, authTag, data } = JSON.parse(raw);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (err) {
      return {};
    }
  }
}
