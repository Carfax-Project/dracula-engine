/** esbuild's text loader turns a .glsl import into the file's source as a string. */
declare module '*.glsl' {
  const source: string;
  export default source;
}
