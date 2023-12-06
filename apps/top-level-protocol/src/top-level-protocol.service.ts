import { Injectable } from '@nestjs/common';

@Injectable()
export class TopLevelProtocolService {
  getHello(): string {
    return 'Hello World!';
  }
}
