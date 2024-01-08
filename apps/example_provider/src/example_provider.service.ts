import { Injectable } from '@nestjs/common';

@Injectable()
export class ExampleProviderService {
  getHello(): string {
    return 'Hello World!';
  }
}
