import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { HeaderAPIKeyStrategy } from "passport-headerapikey";
import { AuthService } from "./auth.service";

type verifiedCallback = (err: Error | null, user?: object, info?: object) => void;

@Injectable()
/**
 * Read more about the strategy here https://github.com/hydra-newmedia/passport-headerapikey/blob/master/src/Strategy.ts
 */
export class ApiKeyStrategy extends PassportStrategy(HeaderAPIKeyStrategy, "api-key-strategy") {
  constructor(private readonly authService: AuthService) {
    super(
      { header: "X-API-KEY", prefix: "" },
      true,
      (apiKey: string, verified: verifiedCallback, req: Request) => {
        if (this.authService.validateApiKey(apiKey)) {
          verified(null, {}, {});
          return req;
        } else {
          verified(new UnauthorizedException(), {}, {});
        }
      }
    );
  }
}
