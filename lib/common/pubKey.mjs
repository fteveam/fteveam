import{TOKEN_PROGRAM_ID as s}from"@solana/spl-token";import{PublicKey as t,SystemProgram as a,SYSVAR_RENT_PUBKEY as u}from"@solana/web3.js";function o({pubkey:e,isSigner:n=!1,isWritable:r=!0}){return{pubkey:e,isWritable:r,isSigner:n}}var w=[o({pubkey:s,isWritable:!1}),o({pubkey:a.programId,isWritable:!1}),o({pubkey:u,isWritable:!1})];function x({publicKey:e,transformSol:n}){if(e instanceof t)return n&&e.equals(c)?i:e;if(n&&e===c.toBase58())return i;if(typeof e=="string")try{return new t(e)}catch{throw new Error("invalid public key")}throw new Error("invalid public key")}function f(e){try{return new t(e)}catch{return e}}var k=new t("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"),l=new t("Ea5SjE2Y6yvCeW5dYTn7PYMuW5ikXkvbGdcmSnXeaLjS"),A=new t("SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt"),P=new t("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),Y=new t("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),g=new t("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"),m=new t("7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj"),W=new t("USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX"),R=new t("NRVwhjBQiUPYtfDT5zRBVJajzFQHaBUNtC7SNVvqRFa"),U=new t("ANAxByE6G2WjFp7A4NqtWYXb3mgruyzZYg3spfxe6Lbo"),d=new t("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),i=new t("So11111111111111111111111111111111111111112"),c=t.default;export{U as ANAMint,d as ETHMint,R as NRVMint,l as PAIMint,k as RAYMint,c as SOLMint,A as SRMMint,P as USDCMint,W as USDHMint,Y as USDTMint,i as WSOLMint,o as accountMeta,w as commonSystemAccountMeta,g as mSOLMint,m as stSOLMint,f as tryParsePublicKey,x as validateAndParsePublicKey};
//# sourceMappingURL=pubKey.mjs.map