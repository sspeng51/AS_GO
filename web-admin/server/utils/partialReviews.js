// Extract only closed JSON review objects from an interrupted reviews array.
// Strings/escapes are tracked; incomplete objects are never guessed or repaired.
function completedReviews(text) {
 const start=/"reviews"\s*:\s*\[/.exec(text||'')
 if(!start)return []
 const reviews=[];let begin=-1,depth=0,quoted=false,escape=false
 for(let i=start.index+start[0].length;i<text.length;i++){
  const c=text[i]
  if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue}
  if(c==='"'){quoted=true;continue}
  if(begin<0){if(c===']')break;if(c==='{'){begin=i;depth=1}continue}
  if(c==='{')depth++
  if(c==='}'&&--depth===0){try{const value=JSON.parse(text.slice(begin,i+1));if(value&&typeof value.id==='string'&&value.result)reviews.push(value)}catch{}begin=-1}
 }
 return reviews
}
module.exports={completedReviews}
