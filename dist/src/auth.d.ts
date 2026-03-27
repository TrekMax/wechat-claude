/**
 * WeChat iLink QR code login flow.
 * Implements the login directly via HTTP API (not through SDK's QrAuthProvider)
 * because we need access to qrcode_img_content for terminal rendering.
 */
export interface TokenData {
    token: string;
    baseUrl: string;
    accountId?: string;
    userId?: string;
    savedAt: string;
}
export declare function login(params: {
    baseUrl: string;
    botType?: string;
    storageDir: string;
    renderQr?: (url: string) => void;
}): Promise<TokenData>;
export declare function loadToken(storageDir: string): TokenData | null;
export declare function saveToken(storageDir: string, data: TokenData): void;
//# sourceMappingURL=auth.d.ts.map