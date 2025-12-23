/* eslint-disable */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => this.convertBigIntToString(data)));
  }

  private convertBigIntToString(data: any): any {
    if (typeof data !== "object") {
      if (typeof data === "bigint") {
        data = data.toString();
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.convertBigIntToString(item));
    }

    Object.keys(data).forEach((key) => {
      data[key] = this.convertBigIntToString(data[key]);
    });

    return data;
  }
}
