/**
 * Builtin shape requirements from the public r495.2 PluginInfo constructors.
 * SHA256: 9644e45e5bfe39d9c72ed4d8acb1dd9368edf5324f30ffe3b6797d9da56c45d7.
 */
export interface BuiltinPluginShape {
  kind: 'world' | 'singleton' | 'nonworld';
  asset?: 'image' | 'animations';
  fixedFrames?: number;
  tileCollisionPolys?: boolean;
  worldOrigin?: readonly [number, number] | 'property';
  fixedSize?: readonly [number, number];
}

// Plugin OnCreate overrides loaded world geometry; mirror the r495.2 initialization before writing new placements.
export const ORIGIN_COORDINATES: Readonly<Record<string, readonly [number, number]>> = {
  'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
};

export const BUILTIN_PLUGIN_SHAPES: Readonly<Record<string, BuiltinPluginShape>> = {
  AJAX: { kind: 'singleton' },
  AdvancedRandom: { kind: 'singleton' },
  Arr: { kind: 'nonworld' },
  Audio: { kind: 'singleton' },
  BBCMicroBit: { kind: 'singleton' },
  BinaryData: { kind: 'nonworld' },
  Bluetooth: { kind: 'singleton' },
  Browser: { kind: 'singleton' },
  Button: { kind: 'world', worldOrigin: [0, 0] },
  C2WebSocket: { kind: 'singleton' },
  CORDOVAIAP: { kind: 'singleton' },
  CSV: { kind: 'singleton' },
  Camera3D: { kind: 'singleton' },
  Clipboard: { kind: 'singleton' },
  ConstructGameServices: { kind: 'singleton' },
  Cryptography: { kind: 'nonworld' },
  Date: { kind: 'singleton' },
  Dictionary: { kind: 'nonworld' },
  DrawingCanvas: { kind: 'world', worldOrigin: 'property' },
  Facebook: { kind: 'singleton' },
  FileSystem: { kind: 'singleton' },
  Flowchart: { kind: 'nonworld' },
  Function: { kind: 'singleton' },
  GameRecorder: { kind: 'singleton' },
  Geolocation: { kind: 'singleton' },
  HTMLElement: { kind: 'world', worldOrigin: 'property' },
  InstantGames: { kind: 'singleton' },
  Internationalization: { kind: 'singleton' },
  Json: { kind: 'nonworld' },
  Keyboard: { kind: 'singleton' },
  List: { kind: 'world', worldOrigin: [0, 0] },
  LocalStorage: { kind: 'singleton' },
  MIDI: { kind: 'singleton' },
  Model3D: { kind: 'world' },
  Mouse: { kind: 'singleton' },
  Multiplayer: { kind: 'singleton' },
  NinePatch: { kind: 'world', asset: 'image', worldOrigin: 'property' },
  NodeWebkit: { kind: 'singleton' },
  Particles: { kind: 'world', asset: 'image', worldOrigin: [0, 0.5] },
  PlatformInfo: { kind: 'singleton' },
  SVGPicture: { kind: 'world', worldOrigin: 'property' },
  ScirraArcadeV4: { kind: 'singleton' },
  Shape3D: { kind: 'world', asset: 'animations', fixedFrames: 6 },
  Share: { kind: 'singleton' },
  SpeechRecognition: { kind: 'singleton' },
  SpeechSynthesis: { kind: 'singleton' },
  Sprite: { kind: 'world', asset: 'animations' },
  Spritefont2: { kind: 'world', asset: 'image' },
  Text: { kind: 'world', worldOrigin: 'property' },
  TextBox: { kind: 'world', worldOrigin: [0, 0] },
  TiledBg: { kind: 'world', asset: 'image', worldOrigin: 'property' },
  Tilemap: { kind: 'world', asset: 'image', tileCollisionPolys: true, worldOrigin: [0, 0] },
  Timeline: { kind: 'singleton' },
  Touch: { kind: 'singleton' },
  Twitter: { kind: 'world', worldOrigin: [0, 0] },
  UserMedia: { kind: 'world', worldOrigin: [0, 0] },
  XML: { kind: 'nonworld' },
  XboxLive: { kind: 'singleton' },
  advert: { kind: 'singleton' },
  filechooser: { kind: 'world', worldOrigin: [0, 0] },
  gamecenter: { kind: 'singleton' },
  gamepad: { kind: 'singleton' },
  googleplay: { kind: 'singleton' },
  iframe: { kind: 'world', worldOrigin: [0, 0] },
  progressbar: { kind: 'world', worldOrigin: [0, 0] },
  pubcenter: { kind: 'singleton' },
  qrcode: { kind: 'world', worldOrigin: [0, 0] },
  shadowlight: { kind: 'world', worldOrigin: [0.5, 0.5], fixedSize: [50, 50] },
  sliderbar: { kind: 'world', worldOrigin: [0, 0] },
  system: { kind: 'singleton' },
  video: { kind: 'world', worldOrigin: [0, 0] },
  win8: { kind: 'singleton' },
};

export function builtinPluginShape(id: string): BuiltinPluginShape | undefined {
  return Object.hasOwn(BUILTIN_PLUGIN_SHAPES, id) ? BUILTIN_PLUGIN_SHAPES[id] : undefined;
}
