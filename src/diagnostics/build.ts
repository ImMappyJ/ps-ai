declare const __PSAI_BUILD_ID__:string;
// Source/harness builds must never pretend to identify a packaged revision.
export const BUILD_ID=typeof __PSAI_BUILD_ID__==='string'?__PSAI_BUILD_ID__:'PS-AI dev (unbuilt)';
