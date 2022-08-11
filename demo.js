const demo = async () => {
    await sendMessage('Page.bringToFront');
    await navigate(`https://www.google.com`)
       await evaluate(`
              snippetContext.do()
                  .waitElement('input')
                  .focus()
                  .type('baby shark')
                  .enter()
                  .getPromise();
       `);
  
}