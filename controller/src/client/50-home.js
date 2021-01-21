wg.pages.home = {
    async render(container) {
        container.append(DIV().text(
            await wg.controller.version()
        ));
    }
}