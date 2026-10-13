// UI test backend only. PostgreSQL implementation is tested independently.
module.exports = function makeRpc({getDb,setDb,log,nextId}) {
 let receipts=new Map(),fault=null;
 const clone=x=>JSON.parse(JSON.stringify(x));
 function reset(){receipts=new Map();fault=null;}
 function setFault(value){fault=value;}
 async function rpc(params){
  const {p_operation_id:id,p_kind:kind,p_payload:p}=params;
  log({op:'rpc',table:'transactions',payload:params,filters:[]});
  const before=clone(getDb()),beforeReceipts=new Map([...receipts].map(([k,v])=>[k,clone(v)]));let result,replayed=false;
  try{
   const known=receipts.get(id);
   if(known){if(known.kind!==kind||JSON.stringify(known.payload)!==JSON.stringify(p))throw Error('Operation key reused');result=clone(known.result);replayed=true;}
   else {
    const db=getDb(),tx=db.transactions;
    if(p.card_ids){
     if(!Array.isArray(p.card_ids)||p.card_ids.length!==2||p.card_ids[0]===p.card_ids[1])throw Error('Two linked balances required');
     const groupFault=fault;fault=null;
     const name=r=>r.description.replace(/ *· *purchases$/,'');
     if(kind==='undo'){
      const deleted=receipts.get(p.delete_operation_id);if(!deleted||deleted.undone||JSON.stringify(deleted.result.deleted._cardIds)!==JSON.stringify(p.card_ids))throw Error('Card deletion unavailable');
      for(const partId of p.card_ids){const response=await rpc({p_operation_id:id+':'+partId+':undo',p_kind:'undo',p_payload:{delete_operation_id:p.delete_operation_id+':'+partId+':delete'}});if(response.error)throw Error(response.error.message);}
      deleted.undone=true;result={restored_id:p.card_ids[0]};
     }else{
      const parts=p.card_ids.map(partId=>tx.find(t=>t.id===partId&&t.user_id==='user-A'&&t.type==='loan'));if(parts.some(x=>!x))throw Error('Card not found');
      const source=l=>(l.lender.match(/account:([^|]+)/)||[])[1]?.trim();if(!source(parts[0])?.startsWith('import:card:')||source(parts[1])!==source(parts[0])+':installments')throw Error('Unrelated balances');
      const balance=parts.reduce((n,l)=>n+Number(l.balance||0),0),minimum=parts.reduce((n,l)=>n+(Number(l.balance)>0?Number(l.min_payment||l.amount):0),0),original=parts.reduce((n,l)=>n+Number(l.original_balance==null?l.balance:l.original_balance),0);
      if(kind==='delete'){
       const deleted={...clone(parts[0]),description:name(parts[0]),balance,amount:minimum,min_payment:minimum,_cardIds:p.card_ids};
       for(const part of parts){const response=await rpc({p_operation_id:id+':'+part.id+':delete',p_kind:'delete',p_payload:{id:part.id}});if(response.error)throw Error(response.error.message);}
       result={removed_id:p.card_ids[0],deleted,restore_info:null};
      }else if(kind==='record'){
       let left=Number(p.extra),interest=0,principal=0,total=0,extra=0;if(!Number.isFinite(left)||left<0||balance<=0)throw Error('Invalid payment');
       for(const part of [...parts].sort((a,b)=>Number(b.apr)-Number(a.apr))){if(Number(part.balance)<=0)continue;if(part.apr==null)throw Error('Unknown rate');const int=p.include_monthly?Number(part.balance)*Number(part.apr)/100/12:0;const mp=p.include_monthly?Math.min(Number(part.balance),Math.max(0,Math.min(Number(part.min_payment||part.amount),Number(part.balance)+int)-int)):0;const allocated=Math.min(left,Number(part.balance)-mp);if(!p.include_monthly&&allocated<=0)continue;const response=await rpc({p_operation_id:id+':'+part.id+':record',p_kind:'record',p_payload:{loan_id:part.id,extra:allocated,include_monthly:p.include_monthly,date:p.date}});if(response.error)throw Error(response.error.message);const r=response.data;interest+=r.interest;principal+=r.principal;total+=r.total_paid;extra+=r.extra_paid;left-=r.extra_paid;}
       if(total<=0)throw Error('No payment');result={loan_id:parts[0].id,loan_description:name(parts[0]),before_balance:balance,new_balance:balance-principal,original_balance:original,apr:parts[1].apr,minimum_payment:minimum,interest,principal,total_paid:total,extra_paid:extra};
      }else throw Error('Unknown operation');
     }
     fault=groupFault;
    }else if(kind==='record'){
     const loan=tx.find(t=>t.id===p.loan_id&&t.user_id==='user-A'&&t.type==='loan');if(!loan)throw Error('Loan not found');
     const bal=Number(loan.balance==null?loan.amount:loan.balance),min=Number(loan.min_payment==null?loan.amount:loan.min_payment),extra=Number(p.extra),rate=Number(loan.apr||0)/100/12;
     if(bal<=0||!Number.isFinite(extra)||extra<0)throw Error('Invalid payment');
     const interest=p.include_monthly?bal*rate:0,regular=p.include_monthly?Math.min(min,bal+interest):0;
     const mp=Math.min(bal,Math.max(0,regular-interest)),ep=Math.min(bal-mp,extra);
     const row=(amount,principal,suffix)=>({id:nextId(),user_id:'user-A',type:'expense',description:loan.description+suffix,amount,date:p.date,category:'loan_payment',recurring:false,frequency:null,anchor_date:null,apr:null,min_payment:null,balance:null,lender:null,created_at:'now',original_balance:null,original_min_payment:null,principal_applied:principal,loan_id:loan.id});
     if(regular>0)tx.push(row(regular,mp,' payment'));if(ep>0)tx.push(row(ep,ep,' extra payment'));
     loan.balance=bal-mp-ep;if(loan.original_balance==null)loan.original_balance=bal;
     result={loan_id:loan.id,loan_description:loan.description,before_balance:bal,new_balance:loan.balance,original_balance:loan.original_balance,apr:loan.apr,minimum_payment:min,interest,principal:mp+ep,total_paid:regular+ep,extra_paid:ep};
    }else if(kind==='delete'){
     const target=tx.find(t=>t.id===p.id&&t.user_id==='user-A');if(!target)throw Error('Transaction not found');
     let info=null;
     if(target.type==='expense'&&target.category==='loan_payment'){
      const loans=tx.filter(t=>t.user_id==='user-A'&&t.type==='loan');
      const matches=target.loan_id?loans.filter(l=>l.id===target.loan_id):loans.filter(l=>target.description===l.description+' payment'||target.description===l.description+' extra payment');
      if(matches.length>1)throw Error('Ambiguous legacy payment');const loan=matches[0];
      if(loan){const bal=Number(loan.balance==null?loan.amount:loan.balance);const principal=target.principal_applied!=null?Number(target.principal_applied):target.description===loan.description+' extra payment'?Number(target.amount):Math.max(0,Number(target.amount)-bal*Number(loan.apr||0)/100/12);loan.balance=bal+principal;info={loanId:loan.id,loanDescription:loan.description,amount:principal,estimated:target.principal_applied==null};}
     }
     result={removed_id:target.id,deleted:clone(target),restore_info:info};db.transactions=tx.filter(t=>t.id!==p.id);
    }else if(kind==='undo'){
     const deleted=receipts.get(p.delete_operation_id);if(!deleted||deleted.kind!=='delete'||deleted.undone)throw Error('Deletion unavailable');
     const info=deleted.result.restore_info;
     if(info){const loan=tx.find(t=>t.id===info.loanId&&t.user_id==='user-A');if(!loan||Number(loan.balance)<info.amount)throw Error('Loan balance changed');loan.balance=Number(loan.balance)-info.amount;}
     tx.push(clone(deleted.result.deleted));deleted.undone=true;result={restored_id:deleted.result.deleted.id};
    }else throw Error('Unknown operation');
    if(fault==='rollback-'+kind){fault=null;throw Error('Injected '+kind+' failure');}
    receipts.set(id,{kind,payload:clone(p),result:clone(result),undone:false});
   }
  }catch(e){setDb(before);receipts=beforeReceipts;return {data:null,error:{code:'P0001',message:e.message}};}
  if(fault==='lost-after-commit'){fault=null;throw Error('Connection dropped after commit');}
  return {data:{...result,operation_id:id,kind,replayed,transactions:clone(getDb().transactions.filter(t=>t.user_id==='user-A'))},error:null};
 }
 return {rpc,reset,setFault};
};
