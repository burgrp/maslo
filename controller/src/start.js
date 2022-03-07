process.env.DEBUG = process.env.DEBUG || "app:*";

require("@burgrp/appglue")({ require, file: __dirname + "/../appglue.json" }).main(async ({
    webserver,
    rest,
    models
}) => {
    let app = await webserver.start();
    rest.start(app);

    models.start();
});