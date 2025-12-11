import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AuthService {
  API_KEYS: string[];
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly configService: ConfigService) {
    const API_KEYS = configService.get<string[]>("api_keys");
    this.logger.log("API_KEYS: " + API_KEYS.join(", "));
    if (!API_KEYS) {
      throw new Error("Env variables are missing (API_KEYS)");
    }
    if (API_KEYS.length === 0) {
      this.logger.warn("No API keys are set. This means that the no-one will be able to access the API.");
    }
    this.API_KEYS = API_KEYS;
  }

  validateApiKey(apiKey: string): boolean {
    return this.API_KEYS.includes(apiKey);
  }
}
