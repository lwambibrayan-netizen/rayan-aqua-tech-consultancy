import { describe, expect, it } from 'vitest';
import { fromInp, toInp } from '../EpanetEnginePanel';

describe('EPANET INP exchange',()=>{
  it('preserves closed pump and valve link statuses through saved INP exchange',()=>{
    const network:any={
      nodes:[
        {id:'R1',kind:'R',x:0,y:0,elevation:0,demand:0,head:110,initialLevel:0,minLevel:0,maxLevel:0,diameter:0,minVolume:0},
        {id:'J1',kind:'J',x:100,y:0,elevation:95,demand:10,head:0,initialLevel:0,minLevel:0,maxLevel:0,diameter:0,minVolume:0},
        {id:'R2',kind:'R',x:200,y:0,elevation:0,demand:0,head:108,initialLevel:0,minLevel:0,maxLevel:0,diameter:0,minVolume:0}
      ],
      links:[
        {id:'P1',kind:'pipe',from:'R1',to:'J1',length:100,diameter:150,roughness:130,minorLoss:0,status:'Open',valveType:'PRV',setting:30,pumpCurve:'20:55'},
        {id:'PU1',kind:'pump',from:'J1',to:'R2',length:0,diameter:0,roughness:130,minorLoss:0,status:'Closed',valveType:'PRV',setting:30,pumpPower:4,pumpCurve:'20:55'},
        {id:'V1',kind:'valve',from:'R1',to:'J1',length:0,diameter:150,roughness:130,minorLoss:0,status:'Closed',valveType:'PRV',setting:25,pumpCurve:'20:55'}
      ],
      settings:{duration:1,step:1,patternStep:1,demandPattern:'',minPressure:15,maxPressure:60,minVelocity:.3,maxVelocity:2,headloss:'H-W',qualityMode:'none',qualityUnits:'Chlorine',qualityStepMinutes:5,qualityBulkReaction:-.5,qualityWallReaction:-.1,tankControls:[],timeControls:[],ruleControls:[]}
    };
    const inp=toInp(network);
    expect(inp).toContain('[STATUS]');
    expect(inp).toContain('PU1 CLOSED');
    expect(inp).toContain('V1 CLOSED');
    const reopened=fromInp(inp);
    expect(reopened.links.find(link=>link.id==='PU1')?.status).toBe('Closed');
    expect(reopened.links.find(link=>link.id==='V1')?.status).toBe('Closed');
    expect(reopened.links.find(link=>link.id==='P1')?.status).toBe('Open');
  });
});
