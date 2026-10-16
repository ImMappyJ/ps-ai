declare module 'pako' {
  export class Inflate {
    constructor(options?:{windowBits?:number;chunkSize?:number});
    ended:boolean;err:number;strm:{avail_in:number};
    onData:(chunk:Uint8Array)=>void;
    push(data:Uint8Array,finish:boolean):boolean;
  }
}
