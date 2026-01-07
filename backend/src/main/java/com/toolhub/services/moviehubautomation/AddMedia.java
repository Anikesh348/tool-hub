package com.toolhub.services.moviehubautomation;

import com.toolhub.Utils.Utility;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMediaControllerFactory;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AddMedia {
    private static final Logger log = LoggerFactory.getLogger(AddMedia.class);
    private final AddMediaControllerFactory addMediaControllerFactory;
    public AddMedia(AddMediaControllerFactory addMediaControllerFactory) {
        this.addMediaControllerFactory = addMediaControllerFactory;
    }

    public void handle(RoutingContext context) {
        try {
            JsonObject lookUpJson = context.body().asJsonObject();
            log.debug("AddContent.handle called with body={}", lookUpJson.encode());
            LookUpDTO lookUpDTO = LookUpDTO.fromJson(lookUpJson);
            addMediaControllerFactory.getClient(lookUpDTO.getMediaType()).addContent(lookUpDTO)
                    .onSuccess(res -> Utility.buildResponse(context, 200, Utility.createSuccessResponse("Requested content marked for download")))
                    .onFailure(fail -> Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage())));
        } catch (Exception e) {
            if (e instanceof IllegalArgumentException) {
                Utility.buildResponse(context, 400, Utility.createErrorResponse(e.getMessage()));
                return;
            }
            Utility.buildResponse(context, 500, Utility.createErrorResponse(e.getMessage()));
        }
    }
}
