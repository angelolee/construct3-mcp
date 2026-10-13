import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { Construct3ProjectWriter } from '../../src/construct3/project-writer.js';
import { IdGenerator } from '../../src/construct3/id-generator.js';
import { registerMutationTools } from '../../src/tools/mutations.js';
import { createAnimationFrame, createTiledBgObject } from '../../src/construct3/templates.js';
import { MockServer } from '../mocks/mock-server.js';

const rectangle = [0,0,1,0,1,1,0,1];
describe('Native Circuit Editor compatibility', () => {
  let folder: string;
  let reader: Construct3ProjectReader;
  let server: MockServer;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await server.callTool(name,args);
    expect(result.isError,result.content[0]?.text).not.toBe(true);
    return JSON.parse(result.content[0].text);
  };
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(),'c3-native-compat-'));
    await cp(join(__dirname,'../fixtures/c3-loadable-minimal'),folder,{recursive:true});
    reader=new Construct3ProjectReader(join(folder,'project.c3proj'));await reader.loadProject();
    const idGen=new IdGenerator();await idGen.initialize(reader);
    server=new MockServer();registerMutationTools(server as any,reader,new Construct3ProjectWriter(reader,idGen),idGen);
    await call('create_object',{name:'Player',pluginId:'Sprite'});
    await call('create_layout',{name:'Lab',width:640,height:480});
  });
  afterEach(async () => {await rm(folder,{recursive:true,force:true});});

  it('authors collision geometry through update_frame without changing animation IDs or other frame data',async()=> {
    const before=await reader.readObjectType('Player');
    const animationSid=before.animations!.items[0].sid;
    const imageId=before.animations!.items[0].frames[0].imageSpriteId;
    const result=await call('update_frame',{objectName:'Player',animationName:'Animation 1',frameIndex:0,collisionPoints:[0,0,1,0,0.5,1],useCollisionPoly:true});
    const object=await reader.readObjectType('Player');const frame=object.animations!.items[0].frames[0];
    expect(frame.collisionPoly).toEqual({points:[0,0,1,0,0.5,1]});expect(frame.useCollisionPoly).toBe(true);
    expect(frame.imageSpriteId).toBe(imageId);expect(object.animations!.items[0].sid).toBe(animationSid);
    expect(frame.width).toBe(100);expect(result.backupFile).toBeTruthy();
  });
  it('can disable polygon use and restore the default rectangle explicitly',async()=> {
    await call('update_frame',{objectName:'Player',animationName:'Animation 1',frameIndex:0,useCollisionPoly:false});
    expect((await reader.readObjectType('Player')).animations!.items[0].frames[0].useCollisionPoly).toBe(false);
    await call('update_frame',{objectName:'Player',animationName:'Animation 1',frameIndex:0,collisionPoints:rectangle,useCollisionPoly:true});
    const frame=(await reader.readObjectType('Player')).animations!.items[0].frames[0];
    expect(frame.collisionPoly ?? {points:rectangle}).toEqual({points:rectangle});expect(frame.useCollisionPoly).toBe(true);
  });
  for(const points of [[],[0,0,1,0],[0,0,1,0,0.5],[0,0,1,0,1.2,1],[0,0,1,0,Number.NaN,1],[0,0,0,0,0,0],Array(66).fill(0)]) {
    it('rejects malformed collision geometry before changing files: '+JSON.stringify(points),async()=> {
      const path=join(folder,'objectTypes/player.json');const bytes=await readFile(path);const names=await readdir(join(folder,'objectTypes'));
      await expect(server.callTool('update_frame',{objectName:'Player',animationName:'Animation 1',frameIndex:0,width:20,collisionPoints:points})).rejects.toThrow();
      expect(await readFile(path)).toEqual(bytes);expect(await readdir(join(folder,'objectTypes'))).toEqual(names);
    });
  }
  it('uses the Editor default rectangle for fresh Sprite frames and single images',()=> {
    const effective=(frame: any)=>frame.collisionPoly?.points ?? rectangle;
    expect(effective(createAnimationFrame(64,64))).toEqual(rectangle);
    expect(effective((createTiledBgObject('Background',1) as any).image)).toEqual(rectangle);
  });
  it('writes instance world.z while retaining the public zElevation argument and the layer field',async()=> {
    const placement=await call('add_instance_to_layout',{layoutName:'Lab',layerName:'Layer 0',objectType:'Player',x:12,y:24,zElevation:7});
    let layout=await reader.readLayout('Lab');let world=layout.layers[0].instances[0].world!;
    expect(world.z).toBe(7);expect(world.zElevation).toBeUndefined();
    await call('update_instance',{layoutName:'Lab',uid:placement.generatedUid,zElevation:-3});
    await call('update_layer',{layoutName:'Lab',layerName:'Layer 0',zElevation:11});
    layout=await reader.readLayout('Lab');world=layout.layers[0].instances[0].world!;
    expect(world.z).toBe(-3);expect(world.zElevation).toBeUndefined();expect(layout.layers[0].zElevation).toBe(11);
  });
  it('keeps native Sprite defaults when a caller supplies partial instance properties',async()=> {
    await call('add_instance_to_layout',{layoutName:'Lab',layerName:'Layer 0',objectType:'Player',x:0,y:0,properties:{'initial-frame':3}});
    const properties=(await reader.readLayout('Lab')).layers[0].instances[0].properties;
    expect(properties['initial-frame']).toBe(3);expect(properties['enable-collisions']).toBe(true);expect(properties['initial-animation']).toBe('Animation 1');
  });
  it('auto-registers the canonical EightDir addon and materializes the Bound layout default',async()=> {
    await call('update_object_properties',{name:'Player',addBehaviors:[{name:'Movement',behaviorId:'EightDir'},{name:'Bounds',behaviorId:'bound'}]});
    await call('add_instance_to_layout',{layoutName:'Lab',layerName:'Layer 0',objectType:'Player',x:0,y:0});
    expect(reader.getUsedAddons().some(a=>a.type==='behavior' && a.id==='EightDir')).toBe(true);
    const behaviors=(await reader.readLayout('Lab')).layers[0].instances[0].behaviors as any;
    expect(behaviors.Bounds.properties.region).toBe('layout');
  });
});

describe('Editor-required builtin object shapes',()=> {
  let folder:string;let reader:Construct3ProjectReader;let server:MockServer;
  const call=async(name:string,args:Record<string,unknown>)=>{const r=await server.callTool(name,args);expect(r.isError,r.content[0]?.text).not.toBe(true);return JSON.parse(r.content[0].text);};
  beforeEach(async()=>{
    folder=await mkdtemp(join(tmpdir(),'c3-editor-shapes-'));await cp(join(__dirname,'../fixtures/c3-loadable-minimal'),folder,{recursive:true});
    reader=new Construct3ProjectReader(join(folder,'project.c3proj'));await reader.loadProject();const ids=new IdGenerator();await ids.initialize(reader);server=new MockServer();registerMutationTools(server as any,reader,new Construct3ProjectWriter(reader,ids),ids);
    await call('create_layout',{name:'Lab',width:640,height:480});
  });
  afterEach(async()=>{await rm(folder,{recursive:true,force:true});});
  for(const pluginId of ['NinePatch','Particles','Spritefont2','Tilemap'])it('creates the required image for '+pluginId,async()=>{
    await call('register_addon',{type:'plugin',id:pluginId,name:pluginId});await call('create_object',{name:'ImageType',pluginId});
    const object=await reader.readObjectType('ImageType');const image=object.image as any;
    expect(image).toBeTruthy();expect(image.imageSpriteId).toEqual(expect.any(Number));expect(image.width).toBeGreaterThan(0);
    expect((await readFile(join(folder,'images/imagetype.png'))).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    if(pluginId==='Tilemap')expect(object['tile-collision-polys']).toEqual({});
  });
  it('creates all six Shape3D faces with distinct image identities',async()=>{
    await call('register_addon',{type:'plugin',id:'Shape3D',name:'3D Shape'});await call('create_object',{name:'Cube',pluginId:'Shape3D'});
    const object=await reader.readObjectType('Cube');expect(object.animations?.items).toHaveLength(1);
    const frames=object.animations!.items[0].frames;expect(frames).toHaveLength(6);expect(new Set(frames.map(f=>f.imageSpriteId)).size).toBe(6);
    for(let i=0;i<6;i++)expect((await readFile(join(folder,'images/cube-animation 1-'+String(i).padStart(3,'0')+'.png'))).length).toBeGreaterThan(0);
  });
  it('keeps global Sprite instances on world layers rather than inventing a singleton',async()=>{
    await call('create_object',{name:'GlobalSprite',pluginId:'Sprite',isGlobal:true});const object=await reader.readObjectType('GlobalSprite');
    expect(object.isGlobal).toBe(true);expect(object['singleglobal-inst']).toBeUndefined();expect(object.animations?.items.length).toBe(1);
    await call('add_instance_to_layout',{layoutName:'Lab',layerName:'Layer 0',objectType:'GlobalSprite',x:12,y:16});
    expect((await reader.readLayout('Lab')).layers[0].instances[0].world).toBeTruthy();
  });
  for(const pluginId of ['Cryptography','BinaryData','XML','Flowchart'])it('places '+pluginId+' as a nonworld instance even when isGlobal is false',async()=>{
    await call('register_addon',{type:'plugin',id:pluginId,name:pluginId});await call('create_object',{name:'DataType',pluginId});await call('update_object_properties',{name:'DataType',isGlobal:false});
    const object=await reader.readObjectType('DataType');expect(object['singleglobal-inst']).toBeUndefined();
    await call('add_instance_to_layout',{layoutName:'Lab',layerName:'Layer 0',objectType:'DataType',x:12,y:16});
    const layout=await reader.readLayout('Lab');expect(layout['nonworld-instances']?.some(i=>i.type==='DataType')).toBe(true);expect(layout.layers[0].instances).toHaveLength(0);
  });
});
