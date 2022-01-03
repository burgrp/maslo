wg.pages.calibstretch = {
    async render(container, pageName) {

        let machineState = await wg.machine.getState();

        wg.common.page(container, pageName, [
            H1().text("Chain stretch calibration"),

            ...(
                !machineState.sled.position ? [
                    AHREF({href: "calibxy"}).text("Unknown sled position - please calibrate XY first.")
                ] :
                    [
                        DIV().text("1. Sled needs to be moved to upper left corner."),
                        BUTTON().text("Move sled to upper left corner"),
                        DIV().text("1. Sled needs to be moved to upper right corner."),
                        BUTTON().text("Move sled to upper left corner")
                    ]
            ),



        ]);
    }
}
