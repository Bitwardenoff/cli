import * as program from 'commander';
import * as inquirer from 'inquirer';

import { ApiService } from 'jslib-common/abstractions/api.service';
import { CryptoService } from 'jslib-common/abstractions/crypto.service';
import { CryptoFunctionService } from 'jslib-common/abstractions/cryptoFunction.service';
import { UserService } from 'jslib-common/abstractions/user.service';

import { Response } from 'jslib-node/cli/models/response';
import { MessageResponse } from 'jslib-node/cli/models/response/messageResponse';

import { PasswordVerificationRequest } from 'jslib-common/models/request/passwordVerificationRequest';

import { Utils } from 'jslib-common/misc/utils';

export class UnlockCommand {
    constructor(private cryptoService: CryptoService, private userService: UserService,
        private cryptoFunctionService: CryptoFunctionService, private apiService: ApiService) { }

    async run(password: string, cmd: program.Command) {
        const canInteract = process.env.BW_NOINTERACTION !== 'true';
        if ((password == null || password === '') && canInteract) {
            const answer: inquirer.Answers = await inquirer.createPromptModule({ output: process.stderr })({
                type: 'password',
                name: 'password',
                message: 'Master password:',
            });
            password = answer.password;
        }
        if (password == null || password === '') {
            return Response.badRequest('Master password is required.');
        }

        this.setNewSessionKey();
        const email = await this.userService.getEmail();
        const kdf = await this.userService.getKdf();
        const kdfIterations = await this.userService.getKdfIterations();
        const key = await this.cryptoService.makeKey(password, email, kdf, kdfIterations);

        let passwordValid = false;
        if (key != null) {
            passwordValid = await this.cryptoService.compareAndUpdateKeyHash(password, key);
            if (!passwordValid) {
                const keyHash = await this.cryptoService.hashPassword(password, key);
                const request = new PasswordVerificationRequest();
                request.masterPasswordHash = keyHash;
                try {
                    await this.apiService.postAccountVerifyPassword(request);
                    passwordValid = true;
                    await this.cryptoService.setKeyHash(keyHash);
                } catch { }
            }
        }

        if (passwordValid) {
            await this.cryptoService.setKey(key);
            const res = new MessageResponse('Your vault is now unlocked!', '\n' +
                'To unlock your vault, set your session key to the `BW_SESSION` environment variable. ex:\n' +
                '$ export BW_SESSION="' + process.env.BW_SESSION + '"\n' +
                '> $env:BW_SESSION="' + process.env.BW_SESSION + '"\n\n' +
                'You can also pass the session key to any command with the `--session` option. ex:\n' +
                '$ bw list items --session ' + process.env.BW_SESSION);
            res.raw = process.env.BW_SESSION;
            return Response.success(res);
        } else {
            return Response.error('Invalid master password.');
        }
    }

    private async setNewSessionKey() {
        const key = await this.cryptoFunctionService.randomBytes(64);
        process.env.BW_SESSION = Utils.fromBufferToB64(key);
    }
}
