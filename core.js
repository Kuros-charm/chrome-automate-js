const isDebug = true


const clientCode = `

const tryUntilTimeout = (tryOnce, time) => {
   let done = false;
   let result = null;
   return Promise.race([
      (async () => {
         while (!done){
            result = await tryOnce();
            done = done || !!result
            if (!done){
               await new Promise(res => setTimeout(res, 500));
            }
         }
         return result;
      })(),
      new Promise((_,rej) => setTimeout(() =>{
         done = true;
         rej('timedout');
      }, time))
   ])
};


const callCdpResult = {};


function doCdp(method, params){
    return new Promise((res, rej) => {
        const id = new Date().getTime().toString() + Math.random().toString();
        callCdpResult[id] = {
            res,  rej
        }
        callCdp(JSON.stringify({
            method,
            params,
            expressionOnDone: \`callCdpResult["\${id}"].res()\`,
            expressionOnFailed: \`callCdpResult["\${id}"].rej()\`
        }));
    })
}


class ActionChain {
    delayTime;
    constructor(initValue) {
      this.promise = Promise.resolve(initValue);
    }


    _chain(fn) {
      this.promise = this.promise.then((e) => fn(e));
      if (this.delayTime){
          this.promise = this.promise.then((e) => new Promise(res => setTimeout(() => res(e), this.delayTime)));
      }
      return this;
    }

    setDelay(delayTime) {
      this.delayTime = delayTime;
      return this;
    }

    waitElement(selector, filterFn = x=> true, insidePrevious = false) {
        this._chain((e) => {
            return tryUntilTimeout(
                () =>  [...(insidePrevious ? e : document).querySelectorAll(selector)].find(filterFn),
            10*1000)
         })
   
        return this
    }
    click(){
        this._chain(e => {
            e.click();
            return Promise.resolve(e);
        });
        return this;
    }

    log(){
        this._chain(e => {
            console.log('Action log:',e)
            return Promise.resolve(e);
        });
        return this;
    }
    focus(){
        this._chain(e => {
            e.focus();
            return Promise.resolve(e);
        });
        return this;

    }
    type(content){
        this._chain(e => {
             return (async () => {

                await doCdp("Input.insertText", {  "text": content });
                //for (let c of content) {
                    //await new Promise(res => setTimeout(res, 1000));
                    //await doCdp("Input.insertText", {  "text": c });
                    //await doCdp("Input.dispatchKeyEvent", { "type": "keyUp", "unmodifiedText": c, "text": c });
                    //await doCdp("Input.dispatchKeyEvent", { "type": "char", "unmodifiedText": c, "text": c });
                    //await new Promise(res => setTimeout(res, 1000));
                //}
               
            })();
        });
        return this;

    }

   setValue(value){
       this._chain(e => {
            e.value = value;
            e.dispatchEvent(new Event( 'input', {bubbles: true}));
            e.dispatchEvent(new Event( 'change', {bubbles: true}));
            return Promise.resolve(e)
        });
        return this;
   }

    enter(){
        this._chain(e => {
            return (async () => {
                await doCdp("Input.dispatchKeyEvent", { "type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\\r", "text": "\\r" })
                await doCdp("Input.dispatchKeyEvent", { "type": "char", "windowsVirtualKeyCode": 13, "unmodifiedText": "\\r", "text": "\\r" })
                await doCdp("Input.dispatchKeyEvent", { "type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\\r", "text": "\\r" })
                return e
            })();
        });
        return this;
    }

    tap(fn){
        this._chain(e => {
            return (async () => { await fn(e); return e;})();
        });
        return this;
    }

    wait(ms){
        this._chain(e => {
            return new Promise(res => setTimeout(() => res(e), ms))
        });
        return this;
    }


    branch(branchFns){ // branchFns: (async (ac:ActionChain) => ActionChain)[]
       this._chain(async e => {
            for (let bf of branchFns){
               await bf(new ActionChain(e)).promise;
            }
            return e
        });
      return this
    }

   getPromise(){
      this.promise
   }
    

}
const snippetContext = {
    do: (value = () =>{}) => new ActionChain(value)
}



`;


const defaultEvauateParams = {
   silent: false,
   includeCommandLineAPI: true,
   returnByValue: false,
   generatePreview: false,
   awaitPromise: true
}


const debug = isDebug ? console.debug: () =>{};



const PC = await import('./devtools-frontend/front_end/core/protocol_client/protocol_client.js'); //devtools://devtools/bundled/devtools-frontend/front_end/core/protocol_client/protocol_client.js

const test = PC.InspectorBackend.test

function sendMessage(method, params){
  return new Promise((resolve, reject) => {
  test.sendRawMessage(method, params, (err, ...results) => {
    if (err) {
      return reject(err);
    }
    return resolve(results);
  });
})};

const getCurrentContextId = () => {
   if (currentContextId && executionContexts.find(x=> x.id === currentContextId)){
      return currentContextId;
   }
   return undefined;
}

const evaluate = async (expression, options = {}) => {
   const r = await sendMessage('Runtime.evaluate', {contextId:getCurrentContextId() , ...defaultEvauateParams, ...options, expression});
   const [{exceptionDetails, result}]  = r
   if (exceptionDetails){
      console.error( `when evaluate`,exceptionDetails ,'\n',`${expression}`)
   }
   return r;
  
}

function setUpClient(contextId){
   return evaluate(clientCode, { replMode: true, contextId})
}


const bindingName = 'callCdp';

let messageHandlers = [];
const methodWhitelist = ['Runtime', 'Page', 'Network'];
const methodBlacklist = [
   'Runtime.consoleAPICalled',
   'ExtraInfo',
   'Network.dataReceived',
   'Network.webSocketFrameReceived',
   'Network.resourceChangedPriority'
]


test.onMessageReceived = (x) => {
   if (methodWhitelist.find(method => x.method?.includes(method) 
      && !methodBlacklist.find(method => x.method?.includes(method)) )){
       debug('onMessageReceived', x);
       messageHandlers = messageHandlers.filter(hdr => {
          try {
            return !hdr(x);
          }catch(e){
              console.error('when handle messageHandlers', hdr, x);
          }
          return false;
       })
   }
   
   
    
   
}

function addMessageHandler(hdr){
   messageHandlers.push(hdr)
   const removeFn =  () => {
      const index = messageHandlers.indexOf(hdr);
      if (index > -1) { 
        messageHandlers.splice(index, 1); 
      }
   }
   return removeFn;
}


test.onMessageSent = (x) => {
   if (methodWhitelist.find(method => x.method?.includes(method))
      && !methodBlacklist.find(method => x.method?.includes(method))){
       debug('onMessageSent', x);
   }
}

executionContexts = []
let currentContextId = undefined;

addMessageHandler((x) => {
    (async () =>{
       if (x.method === 'Runtime.bindingCalled' && x.params?.name === bindingName){
         const {payload, executionContextId} = x.params;
           let expressionOnFailedOuter;
           try {
               console.log('START', x)
               const {method, params, expressionOnDone, expressionOnFailed} = JSON.parse(payload);
               expressionOnFailedOuter = expressionOnFailed;
               await sendMessage(method, params)
               console.log('DONE',payload);
               try {
                  await evaluate(expressionOnDone || `console.log('${bindingName} done')`, {contextId:executionContextId})
               }catch(e){
                  if (e.code === -32000){
                     console.log('context may be destroyed, IGNORE')
                  }else{
                     throw e
                  }
               }
           }catch(err){
               console.error('ERR',err)
               try {
                    await evaluate(expressionOnFailedOuter ||`console.error("when handling ${bindingName}","${err?.toString()}")`, {contextId:executionContextId})
               }catch(e){
                  if (e.code === -32000){
                     console.log('context may be destroyed, IGNORE')
                  }else{
                     throw e
                  }
               }
             }
       }
       else if (x.method === "Runtime.executionContextsCleared"){
          executionContexts = []
       }else if (x.method === 'Runtime.executionContextCreated'){
          executionContexts.push(x.params.context)
       }else if (x.method === 'Runtime.executionContextDestroyed'){
          executionContexts = executionContexts.filter(c=> c.id !== x.params.executionContextId)
       }
    })();
   return false
})




sendMessage('Runtime.removeBinding', {name: bindingName});

sendMessage('Runtime.addBinding', {name: bindingName});


setUpClient();



/** start of helper functions*/
const tryUntilTimeout = (tryOnce, time) => {
   let done = false;
   let result = null;
   return Promise.race([
      (async () => {
         while (!done){
            result = await tryOnce();
            done = done || !!result
            if (!done){
               await new Promise(res => setTimeout(res, 500));
            }
         }
         return result;
      })(),
      new Promise((_,rej) => setTimeout(() =>{
         done = true;
         rej('timedout');
      }, time))
   ])
}


const evaluateUntilContext = (expression) => {
   return tryUntilTimeout(
      (async () => {
           for (let ec of executionContexts){
               try {
                  const [{result: {value}}] = await evaluate(expression, {contextId: ec.id});
                  if (value === true){
                     setUpClient(ec.id);
                     currentContextId = ec.id;
                     return ec.id;
                  }
               }catch(e){
                  // do nothing
               }
                   
            }
         }
      ), 30* 1000)
}


const fetch = (url) => {
   return evaluate(`window.fetch('${url}')`);
}

const navigate= async (url) => {
   const [{frameId, loaderId}] =  await sendMessage('Page.navigate', {url, transitionType: 'reload'})
   let done = false;
   const removeFn = addMessageHandler((x) => {
      const {method, params} = x;
      if (method === 'Page.frameNavigated' && params.frame?.id === frameId && params.frame?.loaderId === loaderId){
         done = true;
         setUpClient();
         return true; // remove this listener
      }
   });
   return tryUntilTimeout(() => done, 30*1000)   
}

