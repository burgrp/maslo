process.env.DEBUG = process.env.DEBUG || "app:*";

require("@device.farm/appglue")({ require, file: __dirname + "/../config.json" }).main(async ({
    webserver,
    router,
    ui
}) => {
    await webserver.start();
    await ui.preview(router.loadLocalFile("test1.nc"));
});