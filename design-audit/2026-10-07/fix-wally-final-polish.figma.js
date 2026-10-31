
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync('0:1'));
figma.skipInvisibleInstanceChildren=false;
for (const style of ['Regular','Medium','Semi Bold','Bold']) await figma.loadFontAsync({family:'Inter',style});
const created=[], mutated=[], removed=[];
const vars=await figma.variables.getLocalVariablesAsync();
const byName=(name)=>vars.find(v=>v.name===name);
const styles=await figma.getLocalTextStylesAsync();
const styleNames={body:'WallyUI / Body',title:'WallyUI / Bold 18 / 22',heading:'WallyUI / Heading',meta:'WallyUI / Meta',display:'WallyUI / Display'};
function paint(name){const v=byName(name); if(!v)throw new Error('Missing token '+name); return figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',v);}
function mark(n){created.push(n.id);return n;}
function frame(parent,name,w,mode='VERTICAL',bg=null,padding=0,gap=12,component=false){const n=component?figma.createComponent():figma.createFrame();parent.appendChild(n);created.push(n.id);n.name=name;n.resize(w,20);n.fills=bg?[paint(bg)]:[];n.layoutMode=mode;n.primaryAxisSizingMode=mode==='HORIZONTAL'?'FIXED':'AUTO';n.counterAxisSizingMode=mode==='HORIZONTAL'?'AUTO':'FIXED';n.paddingTop=padding;n.paddingBottom=padding;n.paddingLeft=padding;n.paddingRight=padding;n.itemSpacing=gap;const gv=byName('space/'+gap);if(gv)n.setBoundVariable('itemSpacing',gv);n.clipsContent=false;return n;}
function surface(n){n.cornerRadius=24;n.strokes=[paint('Border')];n.strokeWeight=1;n.strokeAlign='INSIDE';}
async function text(parent,value,kind='body',color='Ink',name=value.slice(0,40)){const n=figma.createText();parent.appendChild(n);created.push(n.id);n.name=name;const s=styles.find(s=>s.name===styleNames[kind]);if(s)await n.setTextStyleIdAsync(s.id);else{n.fontName={family:'Inter',style:'Regular'};n.fontSize=16;n.lineHeight={unit:'PIXELS',value:24};}n.fills=[paint(color)];n.characters=value;n.resize(Math.max(40,parent.width-(parent.paddingLeft||0)-(parent.paddingRight||0)-2),24);n.textAutoResize='HEIGHT';n.layoutSizingHorizontal='FILL';return n;}
function prop(comp,n,label){const key=comp.addComponentProperty(label,'TEXT',n.characters);n.componentPropertyReferences={characters:key};return key;}
function setProps(inst,values){const obj={};for(const [name,value] of Object.entries(values)){const key=Object.keys(inst.componentProperties).find(k=>k===name||k.split('#')[0]===name);if(key)obj[key]=value;}inst.setProperties(obj);}
async function instance(parent,id,name,values={},width=null){const master=await figma.getNodeByIdAsync(id);if(!master||master.type!=='COMPONENT')throw new Error('Bad component '+id);const n=master.createInstance();parent.appendChild(n);mark(n);if(name)n.name=name;setProps(n,values);if(width)n.resize(width,n.height);return n;}
async function button(parent,label,tone='black',w=null){return instance(parent,tone==='yellow'?'416:3139':tone==='outline'?'110:524':'110:508','Action / '+label,{Label:label},w||parent.width-(parent.paddingLeft||0)-(parent.paddingRight||0)-2);}
async function expose(comp,inst,name){const main=await inst.getMainComponentAsync();const k=comp.addComponentProperty(name,'INSTANCE_SWAP',main.id);inst.componentPropertyReferences={...(inst.componentPropertyReferences||{}),mainComponent:k};inst.isExposedInstance=true;return k;}
async function note(parent,title,detail,bg='Button/Random/Lilac/Soft',icon='222:1451'){const n=await instance(parent,'692:8851','Context / '+title,{Title:title,Detail:detail,Icon:icon});n.fills=[paint(bg)];return n;}
function tracked(){return {createdNodeIds:[...new Set(created)],mutatedNodeIds:[...new Set(mutated)],removedNodeIds:[...new Set(removed)]};}
function variants(nodes,parent,name,col=3){const set=figma.combineAsVariants(nodes,parent);created.push(set.id);set.name=name;let heights=[];for(let i=0;i<nodes.length;i++){const row=Math.floor(i/col);heights[row]=Math.max(heights[row]||0,nodes[i].height);}const ys=heights.map((h,i)=>24+heights.slice(0,i).reduce((a,x)=>a+x+32,0));nodes.forEach((n,i)=>{n.x=24+(i%col)*416;n.y=ys[Math.floor(i/col)];});set.resizeWithoutConstraints(Math.min(nodes.length,col)*416+16,ys.at(-1)+heights.at(-1)+24);return set;}
function connect(node,destination){node.reactions=[{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:destination,navigation:'NAVIGATE',transition:null,resetScrollPosition:true}]}];mutated.push(node.id);}

const shellMaster=await (await figma.getNodeByIdAsync('733:10039')).getMainComponentAsync();for(const n of shellMaster.children)if(/signal|network|battery/.test(n.name)){n.constraints={horizontal:'MAX',vertical:'MIN'};mutated.push(n.id);}
for(const [id,w] of [['764:16077',334],['764:16268',312],['764:16457',328]]){
 const n=await figma.getNodeByIdAsync(id);n.rescale(w/384);for(const t of n.findAll(x=>x.type==='TEXT')){if(typeof t.fontSize==='number'&&t.fontSize<12){t.fontSize=12;t.textAutoResize='HEIGHT';mutated.push(t.id);}}mutated.push(id);
}
for(const id of ['764:16073','764:16264','764:16448']){
 const root=await figma.getNodeByIdAsync(id);
 for(const n of root.findAll(x=>x.type==='INSTANCE'&&/^Asset logo$/.test(x.name))){n.layoutSizingHorizontal='FIXED';n.resize(40,40);mutated.push(n.id);}
 for(const n of root.findAll(x=>x.type==='FRAME'&&x.name==='Market values')){n.layoutSizingHorizontal='FIXED';n.resize(124,n.height);mutated.push(n.id);}
 for(const n of root.findAll(x=>x.type==='INSTANCE'&&/ArrowRight01/.test(x.name))){if(n.parent.layoutMode==='HORIZONTAL')n.layoutSizingHorizontal='FIXED';n.resize(20,20);mutated.push(n.id);}
 for(const row of root.findAll(x=>x.type==='INSTANCE'&&['To Victor','From Emmy','To Daniel'].includes(x.name))){const icon=row.children[0];if(icon.type==='INSTANCE'){icon.layoutSizingHorizontal='FIXED';icon.resize(32,32);mutated.push(icon.id);}const col=row.children.at(-1);col.layoutSizingHorizontal='FIXED';col.resize(148,col.height);mutated.push(col.id);}
 if(root.width>=440){const sidebar=root.children.find(n=>n.name==='Shared navigation');const brand=sidebar.children[0];brand.layoutSizingHorizontal='FIXED';brand.resize(126,41.1);mutated.push(brand.id);const profile=sidebar.children.find(n=>n.name==='Open profile');profile.children[0].layoutSizingHorizontal='FIXED';profile.children[0].resize(40,40);mutated.push(profile.children[0].id);}
}
const market=await figma.getNodeByIdAsync('733:12338');market.itemSpacing=16;market.setBoundVariable('itemSpacing',byName('space/16'));mutated.push(market.id);
const rowMaster=await figma.getNodeByIdAsync('739:11476');rowMaster.paddingTop=12;rowMaster.paddingBottom=12;mutated.push(rowMaster.id);
const headings=(await figma.getNodeByIdAsync('739:11626')).parent;
headings.itemSpacing=16;headings.paddingLeft=16;headings.paddingRight=16;
const widths=[388,148,96,132,132];headings.children.forEach((n,i)=>{n.layoutSizingHorizontal='FIXED';n.resize(widths[i],n.height);if(n.type==='TEXT')n.textAlignHorizontal=i?'RIGHT':'LEFT';mutated.push(n.id);});
mutated.push(headings.id);
for(const [id,ctx,prompt] of [['739:12008','MarketInsight','Explain the Bitcoin 24h chart'],['754:13966','MarketETH','Explain the Ethereum 24h chart'],['754:14257','MarketSOL','Explain the Solana 24h chart'],['754:14546','MarketUSDt','Explain the Tether USDt 24h chart'],['754:14835','MarketXRP','Explain the XRP 24h chart']]){
 const n=await figma.getNodeByIdAsync(id);if(n.type==='INSTANCE'){const source=await figma.getNodeByIdAsync('634:11203');const rs=JSON.parse(JSON.stringify(source.reactions));function walk(actions){for(const a of actions||[]){if(a.type==='SET_VARIABLE'&&a.variableValue?.type==='STRING'){if(a.variableId==='VariableID:588:8000')a.variableValue.value=prompt;else if(a.variableValue.value==='Review')a.variableValue.value=ctx;}if(a.type==='CONDITIONAL')for(const b of a.conditionalBlocks||[])walk(b.actions);}}
 for(const r of rs)walk(r.actions);rs[0].actions.unshift({type:'SET_VARIABLE',variableId:'VariableID:762:15548',variableValue:{type:'BOOLEAN',resolvedType:'BOOLEAN',value:true}});rs[0].actions.push({type:'NODE',navigation:'NAVIGATE',destinationId:'733:10196',transition:null});n.reactions=rs;mutated.push(n.id);}
}

for(const [ticker,pair] of Object.entries({"BTC":{"desktop":"733:12486","mobile":"733:12562"},"ETH":{"desktop":"754:13955","mobile":"754:13970"},"SOL":{"desktop":"754:14246","mobile":"754:14261"},"USDt":{"desktop":"754:14535","mobile":"754:14550"},"XRP":{"desktop":"754:14824","mobile":"754:14839"}})){
 for(const id of [pair.desktop,pair.mobile]){
 const root=await figma.getNodeByIdAsync(id);
 for(const n of root.findAll(x=>x.type==='INSTANCE')){
 const k=Object.keys(n.componentProperties).find(k=>k.split('#')[0]==='Detail');
 if(k&&/Bitcoin (is available|prices)/.test(String(n.componentProperties[k].value))){
 setProps(n,{Detail:'Market prices are for discovery. This wallet sends USDt on supported networks.'});mutated.push(n.id);
 }
 }
 }
}
return tracked();

