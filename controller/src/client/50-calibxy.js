wg.pages.calibxy = {
    async render(container, pageName) {
        wg.common.page(container, pageName, [
            H1().text("Calibration XY"),
            DIV().text("1. Move sled to center line using A and B buttons."),
            DIV().text("2. Move sled vertically using V buttons until sled aligns with marked position."),
            DIV().text("3. Confirm the calibration."),
            DIV("illustration"),

//                         wg.common.manualMoveButton("a up", "caret-up", "a", -1),
//                         wg.common.manualMoveButton("a down", "caret-down", "a", 1),

                        wg.common.manualMoveButton("ab up", "caret-up", "ab", -1),
                        wg.common.manualMoveButton("ab down", "caret-down", "ab", 1),

//                         wg.common.manualMoveButton("b up", "caret-up", "b", -1),
//                         wg.common.manualMoveButton("b down", "caret-down", "b", 1)



        ]);
    }
}
