// Vite replaces (rather than extends) its default deny list when one is set.
// Project work files are accessible only through the editor's scoped voice API.
export const privateDevFiles = [
  '.env',
  '.env.*',
  '*.{crt,pem,key,p12,pfx,cer,der}',
  '.npmrc',
  '.yarnrc.yml',
  '**/.git/**',
  '**/voice-work/**',
];
