package com.global.ct.frameinventory.frame;

import java.util.List;

import com.google.protobuf.Empty;
import io.grpc.stub.StreamObserver;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.stereotype.Service;

import com.global.ct.frameinventory.grpc.v1.CreateFrameRequest;
import com.global.ct.frameinventory.grpc.v1.DeleteFrameRequest;
import com.global.ct.frameinventory.grpc.v1.Frame;
import com.global.ct.frameinventory.grpc.v1.FrameManagementGrpc;
import com.global.ct.frameinventory.grpc.v1.GetFrameHistoryRequest;
import com.global.ct.frameinventory.grpc.v1.GetFrameHistoryResponse;
import com.global.ct.frameinventory.grpc.v1.GetFrameRequest;
import com.global.ct.frameinventory.grpc.v1.ListFramesRequest;
import com.global.ct.frameinventory.grpc.v1.ListFramesResponse;
import com.global.ct.frameinventory.grpc.v1.UpdateFrameRequest;

@Service
class FrameGrpcService extends FrameManagementGrpc.FrameManagementImplBase {
    private static final Logger LOGGER = LoggerFactory.getLogger(FrameGrpcService.class);

    private final FrameService frames;
    private final Validator validator;

    FrameGrpcService(FrameService frames, Validator validator) {
        this.frames = frames;
        this.validator = validator;
    }

    @Override
    public void listFrames(ListFramesRequest request, StreamObserver<ListFramesResponse> response) {
        var query = new ListQuery(
            request.getPage(), request.hasSize() ? request.getSize() : 25,
            request.getStatusesList(), request.getSearch().strip()
        );
        LOGGER.atDebug()
            .addKeyValue("rpc", "ListFrames")
            .addKeyValue("page", query.page())
            .addKeyValue("size", query.size())
            .log("frame.rpc_received");
        validate(query);
        var page = frames.list(query.page(), query.size(), query.statuses(), query.search());
        var items = page.items().stream().map(FrameProtoMapper::toProto).toList();
        reply(response, ListFramesResponse.newBuilder()
            .addAllItems(items)
            .setPage(page.page())
            .setSize(page.size())
            .setHasNext(page.hasNext())
            .build());
    }

    @Override
    public void getFrame(GetFrameRequest request, StreamObserver<Frame> response) {
        requestLog("GetFrame", request.getFrameId()).log("frame.rpc_received");
        validate(new FrameId(request.getFrameId()));
        reply(response, FrameProtoMapper.toProto(frames.detail(request.getFrameId())));
    }

    @Override
    public void getFrameHistory(GetFrameHistoryRequest request, StreamObserver<GetFrameHistoryResponse> response) {
        requestLog("GetFrameHistory", request.getFrameId()).log("frame.rpc_received");
        validate(new FrameId(request.getFrameId()));
        var versions = frames.history(request.getFrameId()).stream().map(FrameProtoMapper::toProto).toList();
        reply(response, GetFrameHistoryResponse.newBuilder().addAllVersions(versions).build());
    }

    @Override
    public void createFrame(CreateFrameRequest request, StreamObserver<Frame> response) {
        requestLog("CreateFrame", request.getFrameId())
            .addKeyValue("hasAttributes", request.hasAttributes())
            .log("frame.rpc_received");
        var command = new Create(
            request.getFrameId(),
            request.hasAttributes() ? FrameProtoMapper.toAttributes(request.getAttributes()) : null
        );
        validate(command);
        reply(response, FrameProtoMapper.toProto(frames.create(command.frameId(), command.attributes())));
    }

    @Override
    public void updateFrame(UpdateFrameRequest request, StreamObserver<Frame> response) {
        requestLog("UpdateFrame", request.getFrameId())
            .addKeyValue("expectedVersionId", request.getExpectedVersionId())
            .addKeyValue("hasAttributes", request.hasAttributes())
            .log("frame.rpc_received");
        var command = new Update(
            request.getFrameId(),
            request.getExpectedVersionId(),
            request.hasAttributes() ? FrameProtoMapper.toAttributes(request.getAttributes()) : null
        );
        validate(command);
        reply(response, FrameProtoMapper.toProto(frames.edit(
            command.frameId(), command.expectedVersionId(), command.attributes()
        )));
    }

    @Override
    public void deleteFrame(DeleteFrameRequest request, StreamObserver<Empty> response) {
        var command = new Delete(
            request.getFrameId(), request.hasExpectedVersionId() ? request.getExpectedVersionId() : null
        );
        requestLog("DeleteFrame", command.frameId())
            .addKeyValue("expectedVersionId", command.expectedVersionId())
            .log("frame.rpc_received");
        validate(command);
        frames.delete(command.frameId(), command.expectedVersionId());
        reply(response, Empty.getDefaultInstance());
    }

    private static LoggingEventBuilder requestLog(String rpc, String frameId) {
        return LOGGER.atDebug()
            .addKeyValue("rpc", rpc)
            .addKeyValue("frameId", frameId.length() <= 128 ? frameId : "<oversize>");
    }

    private void validate(Object request) {
        var violations = validator.validate(request);
        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }
    }

    private static <T> void reply(StreamObserver<T> response, T value) {
        response.onNext(value);
        response.onCompleted();
    }

    private record ListQuery(
        @PositiveOrZero int page,
        @Positive @Max(50) int size,
        List<@Pattern(regexp = "[^\\x00]*") String> statuses,
        @Pattern(regexp = "[^\\x00]*") String search
    ) {}

    private record FrameId(@NotBlank String frameId) {}

    private record Create(
        @NotBlank @Size(max = 128) @Pattern(regexp = "[^\\p{Cntrl}]+") String frameId,
        @NotNull @Valid FrameAttributes attributes
    ) {}

    private record Update(
        @NotBlank String frameId,
        @Positive long expectedVersionId,
        @NotNull @Valid FrameAttributes attributes
    ) {}

    private record Delete(@NotBlank String frameId, @Positive Long expectedVersionId) {}
}
