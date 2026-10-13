/**
 * Builtin shape requirements from the public r495.2 PluginInfo constructors.
 * SHA256: 9644e45e5bfe39d9c72ed4d8acb1dd9368edf5324f30ffe3b6797d9da56c45d7.
 */
export interface BuiltinPluginShape {
  kind: 'world' | 'singleton' | 'nonworld';
  asset?: 'image' | 'animations';
  fixedFrames?: number;
  tileCollisionPolys?: boolean;
}

export const BUILTIN_PLUGIN_SHAPES: Readonly<Record<string, BuiltinPluginShape>> = {
  AJAX: { kind: 'singleton' },
  AdvancedRandom: { kind: 'singleton' },
  Arr: { kind: 'nonworld' },
  Audio: { kind: 'singleton' },
  BBCMicroBit: { kind: 'singleton' },
  BinaryData: { kind: 'nonworld' },
  Bluetooth: { kind: 'singleton' },
  Browser: { kind: 'singleton' },
  Button: { kind: 'world' },
  C2WebSocket: { kind: 'singleton' },
  CORDOVAIAP: { kind: 'singleton' },
  CSV: { kind: 'singleton' },
  Camera3D: { kind: 'singleton' },
  Clipboard: { kind: 'singleton' },
  ConstructGameServices: { kind: 'singleton' },
  Cryptography: { kind: 'nonworld' },
  Date: { kind: 'singleton' },
  Dictionary: { kind: 'nonworld' },
  DrawingCanvas: { kind: 'world' },
  Facebook: { kind: 'singleton' },
  FileSystem: { kind: 'singleton' },
  Flowchart: { kind: 'nonworld' },
  Function: { kind: 'singleton' },
  GameRecorder: { kind: 'singleton' },
  Geolocation: { kind: 'singleton' },
  HTMLElement: { kind: 'world' },
  InstantGames: { kind: 'singleton' },
  Internationalization: { kind: 'singleton' },
  Json: { kind: 'nonworld' },
  Keyboard: { kind: 'singleton' },
  List: { kind: 'world' },
  LocalStorage: { kind: 'singleton' },
  MIDI: { kind: 'singleton' },
  Model3D: { kind: 'world' },
  Mouse: { kind: 'singleton' },
  Multiplayer: { kind: 'singleton' },
  NinePatch: { kind: 'world', asset: 'image' },
  NodeWebkit: { kind: 'singleton' },
  Particles: { kind: 'world', asset: 'image' },
  PlatformInfo: { kind: 'singleton' },
  SVGPicture: { kind: 'world' },
  ScirraArcadeV4: { kind: 'singleton' },
  Shape3D: { kind: 'world', asset: 'animations', fixedFrames: 6 },
  Share: { kind: 'singleton' },
  SpeechRecognition: { kind: 'singleton' },
  SpeechSynthesis: { kind: 'singleton' },
  Sprite: { kind: 'world', asset: 'animations' },
  Spritefont2: { kind: 'world', asset: 'image' },
  Text: { kind: 'world' },
  TextBox: { kind: 'world' },
  TiledBg: { kind: 'world', asset: 'image' },
  Tilemap: { kind: 'world', asset: 'image', tileCollisionPolys: true },
  Timeline: { kind: 'singleton' },
  Touch: { kind: 'singleton' },
  Twitter: { kind: 'world' },
  UserMedia: { kind: 'world' },
  XML: { kind: 'nonworld' },
  XboxLive: { kind: 'singleton' },
  advert: { kind: 'singleton' },
  filechooser: { kind: 'world' },
  gamecenter: { kind: 'singleton' },
  gamepad: { kind: 'singleton' },
  googleplay: { kind: 'singleton' },
  iframe: { kind: 'world' },
  progressbar: { kind: 'world' },
  pubcenter: { kind: 'singleton' },
  qrcode: { kind: 'world' },
  shadowlight: { kind: 'world' },
  sliderbar: { kind: 'world' },
  system: { kind: 'singleton' },
  video: { kind: 'world' },
  win8: { kind: 'singleton' },
};

export function builtinPluginShape(id: string): BuiltinPluginShape | undefined {
  return Object.hasOwn(BUILTIN_PLUGIN_SHAPES, id) ? BUILTIN_PLUGIN_SHAPES[id] : undefined;
}
