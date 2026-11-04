/* ESOWOLF cookie-free counter: page views + button/link clicks (daily totals only). */
(function(){
  if(navigator.webdriver||/localhost|127\.0\.0\.1/.test(location.hostname)&&!/[?&]track=1/.test(location.search)) return;
  var send=function(list){ try{ var b=JSON.stringify({e:list}); if(!(navigator.sendBeacon&&navigator.sendBeacon("/api/t",new Blob([b],{type:"text/plain"})))) fetch("/api/t",{method:"POST",body:b,keepalive:true}); }catch(e){} };
  var clean=function(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9:\/._#@+-]+/g,"-").replace(/-+/g,"-").slice(0,100); };
  var path=location.pathname.replace(/index\.html$/,"")||"/";
  var ev=["view:"+clean(path)];
  try{ var r=document.referrer&&new URL(document.referrer).hostname.replace(/^www\./,""); if(r&&r!==location.hostname.replace(/^www\./,"")) ev.push("ref:"+clean(r)); }catch(e){}
  send(ev);
  document.addEventListener("click",function(e){
    var a=e.target.closest&&e.target.closest("a[href]"); if(!a) return;
    var u; try{ u=new URL(a.href,location.href); }catch(x){ return; }
    var sec=(a.closest("section[id]")||a.closest("header,nav,footer")||{}).id||(a.closest("header,nav")?"nav":a.closest("footer")?"footer":"");
    if(a.id==="waFloat") sec="float"; if(!sec&&/^\/blog\//.test(path)) sec="blog";
    var target;
    if(u.protocol==="tel:") target="call";
    else if(u.protocol==="mailto:") target="email";
    else if(/wa\.me|whatsapp\.com/.test(u.hostname)) target="whatsapp";
    else if(u.hostname===location.hostname){ if(u.pathname===location.pathname) return; target=u.pathname.replace(/index\.html$/,""); }
    else target=u.hostname.replace(/^www\./,"")+u.pathname.replace(/\/$/,"");
    send(["click:"+clean((sec?sec+":":"")+target)]);
  },true);
})();
