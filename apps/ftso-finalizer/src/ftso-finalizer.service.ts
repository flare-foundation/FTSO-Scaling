import { Injectable } from '@nestjs/common';

@Injectable()
export class FtsoFinalizerService {
  getHello(): string {
    return 'Hello World!';
  }
}
