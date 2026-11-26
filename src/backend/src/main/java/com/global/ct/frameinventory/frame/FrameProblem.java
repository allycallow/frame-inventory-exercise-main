package com.global.ct.frameinventory.frame;

final class FrameProblem extends RuntimeException {
    enum Code { FRAME_NOT_FOUND, FRAME_ID_RESERVED, STALE_FRAME_VERSION }

    private final Code code;
    private final Long currentVersionId;

    private FrameProblem(Code code, String message, Long currentVersionId) {
        super(message);
        this.code = code;
        this.currentVersionId = currentVersionId;
    }

    static FrameProblem missing() {
        return new FrameProblem(Code.FRAME_NOT_FOUND, "The frame was not found.", null);
    }

    static FrameProblem reserved() {
        return new FrameProblem(Code.FRAME_ID_RESERVED, "This frame ID has already been used.", null);
    }

    static FrameProblem stale(Long currentVersionId) {
        String detail = currentVersionId == null
            ? "The frame no longer has a current version."
            : "The frame has changed. Fetch its current version before retrying.";
        return new FrameProblem(Code.STALE_FRAME_VERSION, detail, currentVersionId);
    }

    Code code() {
        return code;
    }

    Long currentVersionId() {
        return currentVersionId;
    }
}
