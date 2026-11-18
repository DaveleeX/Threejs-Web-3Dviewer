import { PHYS } from './constants.js';

export const ORIENTATION_REPAIR_PASSES=32;

// Bounded fallback mirrored by scripts/native/orientation-safety.h. A tet's
// determinant is linear when only one node moves, so each incident constraint
// gives an exact admissible fraction of that node's pending displacement.
export class OrientationSafety {
  constructor(body) {
    this.body=body;this.safe=body.rest.slice();
    this.values=new Float64Array(body.elements.length);
    this.offsets=new Uint32Array(body.mass.length+1);
    this.adjacent=new Uint32Array(body.elements.length*4);
    this.center=new Float64Array(3);this.current=new Float64Array(3);
    for(const e of body.elements)for(const id of e.ids)this.offsets[id+1]++;
    for(let n=1;n<this.offsets.length;n++)this.offsets[n]+=this.offsets[n-1];
    for(let e=0;e<body.elements.length;e++)for(const id of body.elements[e].ids)this.adjacent[this.offsets[id]++]=e;
    for(let n=body.mass.length;n>0;n--)this.offsets[n]=this.offsets[n-1];
    this.offsets[0]=0;
  }
  jacobian(e,x) {
    const {offsets:[a,b,c,d],inverseRestDet}=this.body.elements[e];
    const ax=x[b]-x[a],bx=x[c]-x[a],cx=x[d]-x[a];
    const ay=x[b+1]-x[a+1],by=x[c+1]-x[a+1],cy=x[d+1]-x[a+1];
    const az=x[b+2]-x[a+2],bz=x[c+2]-x[a+2],cz=x[d+2]-x[a+2];
    return (ax*(by*cz-cy*bz)-bx*(ay*cz-cy*az)+cx*(ay*bz-by*az))*inverseRestDet;
  }
  minimum(x) {
    let minimum=Infinity;
    for(let e=0;e<this.values.length;e++) {
      const j=this.jacobian(e,x);if(!Number.isFinite(j))return -Infinity;
      minimum=Math.min(minimum,j);if(minimum<.12)return minimum;
    }
    return minimum;
  }
  massCenter(x,out) {
    out.fill(0);const {mass,totalMass}=this.body;
    for(let n=0;n<mass.length;n++) {
      const w=mass[n]/totalMass;
      for(let axis=0;axis<3;axis++)out[axis]+=x[n*3+axis]*w;
    }
  }
  translate(x,center) {
    this.massCenter(x,this.current);
    const dx=center[0]-this.current[0],dz=center[2]-this.current[2];let dy=center[1]-this.current[1];
    for(const contact of this.body.contacts) {
      let y=0;for(const [id,w] of contact.weights)y+=x[id*3+1]*w;
      dy=Math.max(dy,PHYS.floor-y);
    }
    for(let j=0;j<x.length;j+=3){x[j]+=dx;x[j+1]+=dy;x[j+2]+=dz;}
  }
  accept(previous=this.body.previous) {
    const {x,candidate,mass}=this.body,{offsets,adjacent,values,center}=this;
    const reference=this.minimum(previous)>=.12?previous:this.safe;
    this.massCenter(x,center);let finite=true;
    for(let i=0;i<x.length;i++){candidate[i]=x[i];if(!Number.isFinite(x[i]))finite=false;x[i]=reference[i];}
    if(!finite)this.massCenter(reference,center);
    this.translate(x,center);
    for(let e=0;e<values.length;e++)values[e]=this.jacobian(e,x);
    if(finite)for(let pass=0;pass<2;pass++)for(let v=0;v<mass.length;v++) {
      const n=(pass&1)?mass.length-1-v:v,j=n*3,px=x[j],py=x[j+1],pz=x[j+2];
      const dx=candidate[j]-px,dy=candidate[j+1]-py,dz=candidate[j+2]-pz;let alpha=1;
      x[j]=candidate[j];x[j+1]=candidate[j+1];x[j+2]=candidate[j+2];
      for(let i=offsets[n];i<offsets[n+1];i++) {
        const e=adjacent[i],before=values[e],after=this.jacobian(e,x),limit=Math.min(before,.135);
        if(!Number.isFinite(after))alpha=0;
        else if(after<limit)alpha=Math.min(alpha,.99*Math.max(0,before-limit)/(before-after));
      }
      x[j]=px+alpha*dx;x[j+1]=py+alpha*dy;x[j+2]=pz+alpha*dz;
      for(let i=offsets[n];i<offsets[n+1];i++){const e=adjacent[i];values[e]=this.jacobian(e,x);}
    }
    this.translate(x,center);
    let minimum=this.minimum(x);
    if(minimum<.12) {
      x.set(reference);this.translate(x,center);minimum=this.minimum(x);
      if(minimum<.12){x.set(this.safe);minimum=this.minimum(x);}
    }
    return minimum;
  }
  capture(){this.safe.set(this.body.x);}
}
