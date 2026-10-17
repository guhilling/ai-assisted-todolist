/**
 * Images as Metro bundles them: an import of a PNG is the asset, ready for `<Image source>`.
 * Metro picks the `@2x` and `@3x` files beside it for the screen by itself.
 */
declare module '*.png' {
  const source: import('react-native').ImageSourcePropType
  export default source
}
