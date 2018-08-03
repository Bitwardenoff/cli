import * as program from 'commander';
import * as fet from 'node-fetch';

import { CipherType } from 'jslib/enums/cipherType';

import { AuditService } from 'jslib/abstractions/audit.service';
import { CipherService } from 'jslib/abstractions/cipher.service';
import { CollectionService } from 'jslib/abstractions/collection.service';
import { CryptoService } from 'jslib/abstractions/crypto.service';
import { FolderService } from 'jslib/abstractions/folder.service';
import { TokenService } from 'jslib/abstractions/token.service';
import { TotpService } from 'jslib/abstractions/totp.service';
import { UserService } from 'jslib/abstractions/user.service';

import { Organization } from 'jslib/models/domain/organization';

import { CipherView } from 'jslib/models/view/cipherView';
import { CollectionView } from 'jslib/models/view/collectionView';
import { FolderView } from 'jslib/models/view/folderView';

import { Response } from '../models/response';
import { CipherResponse } from '../models/response/cipherResponse';
import { CollectionResponse } from '../models/response/collectionResponse';
import { FolderResponse } from '../models/response/folderResponse';
import { MessageResponse } from '../models/response/messageResponse';
import { OrganizationResponse } from '../models/response/organizationResponse';
import { StringResponse } from '../models/response/stringResponse';
import { TemplateResponse } from '../models/response/templateResponse';

import { Card } from '../models/card';
import { Cipher } from '../models/cipher';
import { Collection } from '../models/collection';
import { Field } from '../models/field';
import { Folder } from '../models/folder';
import { Identity } from '../models/identity';
import { Login } from '../models/login';
import { LoginUri } from '../models/loginUri';
import { SecureNote } from '../models/secureNote';

import { CliUtils } from '../utils';

export class GetCommand {
    constructor(private cipherService: CipherService, private folderService: FolderService,
        private collectionService: CollectionService, private totpService: TotpService,
        private auditService: AuditService, private cryptoService: CryptoService,
        private tokenService: TokenService, private userService: UserService) { }

    async run(object: string, id: string, cmd: program.Command): Promise<Response> {
        if (id != null) {
            id = id.toLowerCase();
        }

        switch (object.toLowerCase()) {
            case 'item':
                return await this.getCipher(id);
            case 'username':
                return await this.getUsername(id);
            case 'password':
                return await this.getPassword(id);
            case 'uri':
                return await this.getUri(id);
            case 'totp':
                return await this.getTotp(id);
            case 'exposed':
                return await this.getExposed(id);
            case 'attachment':
                return await this.getAttachment(id, cmd);
            case 'folder':
                return await this.getFolder(id);
            case 'collection':
                return await this.getCollection(id);
            case 'organization':
                return await this.getOrganization(id);
            case 'template':
                return await this.getTemplate(id);
            default:
                return Response.badRequest('Unknown object.');
        }
    }

    private async getCipher(id: string) {
        let decCipher: CipherView = null;
        if (this.isGuid(id)) {
            const cipher = await this.cipherService.get(id);
            if (cipher != null) {
                decCipher = await cipher.decrypt();
            }
        } else if (id.trim() !== '') {
            let ciphers = await this.cipherService.getAllDecrypted();
            ciphers = CliUtils.searchCiphers(ciphers, id);
            if (ciphers.length > 1) {
                return Response.multipleResults(ciphers.map((c) => c.id));
            }
            if (ciphers.length > 0) {
                decCipher = ciphers[0];
            }
        }

        if (decCipher == null) {
            return Response.notFound();
        }
        const res = new CipherResponse(decCipher);
        return Response.success(res);
    }

    private async getUsername(id: string) {
        const cipherResponse = await this.getCipher(id);
        if (!cipherResponse.success) {
            return cipherResponse;
        }

        const cipher = cipherResponse.data as CipherResponse;
        if (cipher.type !== CipherType.Login) {
            return Response.badRequest('Not a login.');
        }

        if (cipher.login.username == null || cipher.login.username === '') {
            return Response.error('No username available for this login.');
        }

        const res = new StringResponse(cipher.login.username);
        return Response.success(res);
    }

    private async getPassword(id: string) {
        const cipherResponse = await this.getCipher(id);
        if (!cipherResponse.success) {
            return cipherResponse;
        }

        const cipher = cipherResponse.data as CipherResponse;
        if (cipher.type !== CipherType.Login) {
            return Response.badRequest('Not a login.');
        }

        if (cipher.login.password == null || cipher.login.password === '') {
            return Response.error('No password available for this login.');
        }

        const res = new StringResponse(cipher.login.password);
        return Response.success(res);
    }

    private async getUri(id: string) {
        const cipherResponse = await this.getCipher(id);
        if (!cipherResponse.success) {
            return cipherResponse;
        }

        const cipher = cipherResponse.data as CipherResponse;
        if (cipher.type !== CipherType.Login) {
            return Response.badRequest('Not a login.');
        }

        if (cipher.login.uris == null || cipher.login.uris.length === 0 || cipher.login.uris[0].uri === '') {
            return Response.error('No uri available for this login.');
        }

        const res = new StringResponse(cipher.login.uris[0].uri);
        return Response.success(res);
    }

    private async getTotp(id: string) {
        const cipherResponse = await this.getCipher(id);
        if (!cipherResponse.success) {
            return cipherResponse;
        }

        const cipher = cipherResponse.data as CipherResponse;
        if (cipher.type !== CipherType.Login) {
            return Response.badRequest('Not a login.');
        }

        if (cipher.login.totp == null || cipher.login.totp === '') {
            return Response.error('No TOTP available for this login.');
        }

        const totp = await this.totpService.getCode(cipher.login.totp);
        if (totp == null) {
            return Response.error('Couldn\'t generate TOTP code.');
        }

        if (!this.tokenService.getPremium()) {
            const originalCipher = await this.cipherService.get(id);
            if (originalCipher == null || originalCipher.organizationId == null ||
                !originalCipher.organizationUseTotp) {
                return Response.error('A premium membership is required to use this feature.');
            }
        }

        const res = new StringResponse(totp);
        return Response.success(res);
    }

    private async getExposed(id: string) {
        const passwordResponse = await this.getPassword(id);
        if (!passwordResponse.success) {
            return passwordResponse;
        }

        const exposedNumber = await this.auditService.passwordLeaked((passwordResponse.data as StringResponse).data);
        const res = new StringResponse(exposedNumber.toString());
        return Response.success(res);
    }

    private async getAttachment(id: string, cmd: program.Command) {
        if (cmd.itemid == null || cmd.itemid === '') {
            return Response.badRequest('--itemid <itemid> required.');
        }

        const itemId = cmd.itemid.toLowerCase();
        const cipherResponse = await this.getCipher(itemId);
        if (!cipherResponse.success) {
            return cipherResponse;
        }

        const cipher = cipherResponse.data as CipherResponse;
        if (cipher.attachments == null || cipher.attachments.length === 0) {
            return Response.error('No attachments available for this item.');
        }

        const attachments = cipher.attachments.filter((a) => a.id.toLowerCase() === id ||
            (a.fileName != null && a.fileName.toLowerCase().indexOf(id) > -1));
        if (attachments.length === 0) {
            return Response.error('Attachment `' + id + '` was not found.');
        }
        if (attachments.length > 1) {
            return Response.multipleResults(attachments.map((a) => a.id));
        }

        if (!this.tokenService.getPremium()) {
            const originalCipher = await this.cipherService.get(cipher.id);
            if (originalCipher == null || originalCipher.organizationId == null) {
                return Response.error('A premium membership is required to use this feature.');
            }
        }

        const response = await fet.default(new fet.Request(attachments[0].url, { headers: { cache: 'no-cache' } }));
        if (response.status !== 200) {
            return Response.error('A ' + response.status + ' error occurred while downloading the attachment.');
        }

        try {
            const buf = await response.arrayBuffer();
            const key = await this.cryptoService.getOrgKey(cipher.organizationId);
            const decBuf = await this.cryptoService.decryptFromBytes(buf, key);
            const filePath = await CliUtils.saveFile(Buffer.from(decBuf), cmd.output, attachments[0].fileName);
            const res = new MessageResponse('Saved ' + filePath, null);
            res.raw = filePath;
            return Response.success(res);
        } catch (e) {
            if (typeof (e) === 'string') {
                return Response.error(e);
            } else {
                return Response.error('An error occurred while saving the attachment.');
            }
        }
    }

    private async getFolder(id: string) {
        let decFolder: FolderView = null;
        if (this.isGuid(id)) {
            const folder = await this.folderService.get(id);
            if (folder != null) {
                decFolder = await folder.decrypt();
            }
        } else if (id.trim() !== '') {
            let folders = await this.folderService.getAllDecrypted();
            folders = CliUtils.searchFolders(folders, id);
            if (folders.length > 1) {
                return Response.multipleResults(folders.map((f) => f.id));
            }
            if (folders.length > 0) {
                decFolder = folders[0];
            }
        }

        if (decFolder == null) {
            return Response.notFound();
        }
        const res = new FolderResponse(decFolder);
        return Response.success(res);
    }

    private async getCollection(id: string) {
        let decCollection: CollectionView = null;
        if (this.isGuid(id)) {
            const collection = await this.collectionService.get(id);
            if (collection != null) {
                decCollection = await collection.decrypt();
            }
        } else if (id.trim() !== '') {
            let collections = await this.collectionService.getAllDecrypted();
            collections = CliUtils.searchCollections(collections, id);
            if (collections.length > 1) {
                return Response.multipleResults(collections.map((c) => c.id));
            }
            if (collections.length > 0) {
                decCollection = collections[0];
            }
        }

        if (decCollection == null) {
            return Response.notFound();
        }
        const res = new CollectionResponse(decCollection);
        return Response.success(res);
    }

    private async getOrganization(id: string) {
        let org: Organization = null;
        if (this.isGuid(id)) {
            org = await this.userService.getOrganization(id);
        } else if (id.trim() !== '') {
            let orgs = await this.userService.getAllOrganizations();
            orgs = CliUtils.searchOrganizations(orgs, id);
            if (orgs.length > 1) {
                return Response.multipleResults(orgs.map((c) => c.id));
            }
            if (orgs.length > 0) {
                org = orgs[0];
            }
        }

        if (org == null) {
            return Response.notFound();
        }
        const res = new OrganizationResponse(org);
        return Response.success(res);
    }

    private isGuid(id: string) {
        return RegExp(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'i').test(id);
    }

    private async getTemplate(id: string) {
        let template: any = null;
        switch (id.toLowerCase()) {
            case 'item':
                template = Cipher.template();
                break;
            case 'item.field':
                template = Field.template();
                break;
            case 'item.login':
                template = Login.template();
                break;
            case 'item.login.uri':
                template = LoginUri.template();
                break;
            case 'item.card':
                template = Card.template();
                break;
            case 'item.identity':
                template = Identity.template();
                break;
            case 'item.securenote':
                template = SecureNote.template();
                break;
            case 'folder':
                template = Folder.template();
                break;
            case 'collection':
                template = Collection.template();
                break;
            default:
                return Response.badRequest('Unknown template object.');
        }

        const res = new TemplateResponse(template);
        return Response.success(res);
    }
}
