
  /** @type {import('react-native-worklets/plugin').PluginOptions} */
  const workletsPluginOptions = {
  
  }
module.exports = {
  presets: ['module:@react-native/babel-preset','nativewind/babel'],
   plugins: 
      ['react-native-worklets/plugin', workletsPluginOptions],

};
