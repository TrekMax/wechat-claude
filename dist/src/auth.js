/**
 * WeChat iLink QR code login flow.
 * Implements the login directly via HTTP API (not through SDK's QrAuthProvider)
 * because we need access to qrcode_img_content for terminal rendering.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
// -- HTTP helpers --
function randomWechatUin() {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), "utf-8").toString("base64");
}
function buildHeaders() {
    return {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        "X-WECHAT-UIN": randomWechatUin(),
    };
}
async function apiGet(baseUrl, path) {
    const url = `${baseUrl}/${path}`;
    const resp = await fetch(url, {
        headers: buildHeaders(),
    });
    if (!resp.ok) {
        throw new Error(`API GET ${path} failed: ${resp.status}`);
    }
    return (await resp.json());
}
export async function login(params) {
    const { baseUrl, botType, storageDir, renderQr } = params;
    console.log("[auth] Starting WeChat QR login...");
    const qrResp = await apiGet(baseUrl, `ilink/bot/get_bot_qrcode?bot_type=${botType ?? "3"}`);
    console.log("[auth] Please scan the QR code with WeChat:");
    if (renderQr) {
        renderQr(qrResp.qrcode_img_content);
    }
    else {
        console.log(`QR URL: ${qrResp.qrcode_img_content}`);
    }
    const deadline = Date.now() + 5 * 60_000;
    let currentQrcode = qrResp.qrcode;
    let refreshCount = 0;
    while (Date.now() < deadline) {
        const status = await apiGet(baseUrl, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(currentQrcode)}`);
        switch (status.status) {
            case "wait":
                break;
            case "scaned":
                console.log("[auth] QR scanned, please confirm in WeChat...");
                break;
            case "expired": {
                refreshCount++;
                if (refreshCount > 3) {
                    throw new Error("QR code expired multiple times, please retry");
                }
                console.log(`[auth] QR expired, refreshing (${refreshCount}/3)...`);
                const newQr = await apiGet(baseUrl, `ilink/bot/get_bot_qrcode?bot_type=${botType ?? "3"}`);
                currentQrcode = newQr.qrcode;
                if (renderQr) {
                    renderQr(newQr.qrcode_img_content);
                }
                else {
                    console.log(`QR URL: ${newQr.qrcode_img_content}`);
                }
                break;
            }
            case "confirmed": {
                console.log("[auth] Login successful!");
                const tokenData = {
                    token: status.bot_token,
                    baseUrl: status.baseurl || baseUrl,
                    accountId: status.ilink_bot_id,
                    userId: status.ilink_user_id,
                    savedAt: new Date().toISOString(),
                };
                saveToken(storageDir, tokenData);
                console.log(`[auth] Bot ID: ${tokenData.accountId}`);
                return tokenData;
            }
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("Login timeout (5 minutes)");
}
// -- Token persistence --
function getTokenPath(storageDir) {
    return join(storageDir, "token.json");
}
export function loadToken(storageDir) {
    const tokenPath = getTokenPath(storageDir);
    if (!existsSync(tokenPath))
        return null;
    try {
        return JSON.parse(readFileSync(tokenPath, "utf-8"));
    }
    catch {
        return null;
    }
}
export function saveToken(storageDir, data) {
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(getTokenPath(storageDir), JSON.stringify(data, null, 2), "utf-8");
    console.log(`[auth] Token saved to ${getTokenPath(storageDir)}`);
}
//# sourceMappingURL=auth.js.map