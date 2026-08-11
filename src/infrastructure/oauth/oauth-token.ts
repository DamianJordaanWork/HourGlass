import type { TokenSet } from '@domain/ports';

/** Shape of a standard OAuth2 token endpoint response (snake_case wire DTO). */
export interface TokenResponseDto {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

/** Maps a raw OAuth2 token response into our domain `TokenSet`. */
export function toTokenSet(dto: TokenResponseDto): TokenSet {
  return {
    accessToken: dto.access_token,
    refreshToken: dto.refresh_token,
    expiresAt: Date.now() + dto.expires_in * 1000,
    scope: dto.scope,
  };
}
