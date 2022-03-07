wg.pages.config = {
    title: "Configuration",
    async render(container, pageName) {                

        wg.common.page(container, pageName, [
            DIV("header", [
                H1("title").text("Configuration"),
                BUTTON().text("Save").click(() => {
                    wg.common.check(async () => {
                        let data = JSON.parse($(".editor").val());
                        await wg.config.merge(data);
                    })
                })
            ]),            
            TEXTAREA("editor", async el => {
                let data = await wg.config.getModel();
                delete data.lastPosition;                    
                el.val(JSON.stringify(data, null, 2));
            })
        ]);
    }
}
