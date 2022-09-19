import{PublicKey as O}from"@solana/web3.js";import{get as s,set as b}from"lodash";import E from"pino";import V from"pino-pretty";var m={},y={},M=V({colorize:!0,levelFirst:!0,translateTime:"SYS:yyyymmdd HH:MM:ss.l"}),x=E({base:null,level:"silent"},M);function l(r){let e=s(m,r);if(!e){let t=s(y,r);e=x.child({name:r},{level:t}),b(m,r,e)}return e.logWithError=(...t)=>{let n=t.map(o=>typeof o=="object"?JSON.stringify(o):o).join(", ");throw new Error(n)},e}import{PublicKey as g}from"@solana/web3.js";import p from"bn.js";var N=new p(25),w=new p(1e4),R="675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",Y=new g(R),f="5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h",Q=new g(f),W={[R]:4,[f]:5};var u={4:3,5:3};var c=l("Raydium_liquidity_serum"),a="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",D=new O(a),F={[a]:3},T={3:D};function H(r){let e=u[r];return e||c.logWithError("invalid version","version",r),e}function z(r){let e=T[r];return e||c.logWithError("invalid version","version",r),e}async function j({programId:r,marketId:e}){let t=[e.toBuffer()],n=0,o;for(;n<100;){try{let i=t.concat(Buffer.from([n]),Buffer.alloc(7));o=await O.createProgramAddress(i,r)}catch(i){if(i instanceof TypeError)throw i;n++;continue}return{publicKey:o,nonce:n}}throw c.logWithError("unable to find a viable program address nonce","params",{programId:r,marketId:e}),new Error("unable to find a viable program address nonce")}export{F as SERUM_PROGRAMID_TO_VERSION,D as SERUM_PROGRAM_ID_V3,T as SERUM_VERSION_TO_PROGRAM_ID,a as _SERUM_PROGRAM_ID_V3,j as getSerumAssociatedAuthority,z as getSerumProgramId,H as getSerumVersion};
//# sourceMappingURL=serum.mjs.map