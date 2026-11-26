package com.global.ct.frameinventory.inventoryimport;

final class ImportJobProblem extends RuntimeException {
    enum Code { NOT_FOUND, NOT_CONFIGURED }

    private final Code code;

    ImportJobProblem(Code code) {
        this.code = code;
    }

    Code code() {
        return code;
    }
}
