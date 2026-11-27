import type { TypedDocumentNode as DocumentNode } from '@apollo/client';
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type FrameAttributesInput = {
  address?: string | null | undefined;
  airport?: string | null | undefined;
  aspectRatioCode?: string | null | undefined;
  distanceToClosestSchool?: number | null | undefined;
  environment?: string | null | undefined;
  format?: FrameFormatInput | null | undefined;
  illuminationTypeId?: number | null | undefined;
  impactWeight?: string | null | undefined;
  inventorySiteNo?: string | null | undefined;
  latitude?: string | null | undefined;
  location?: FrameLocationInput | null | undefined;
  locationId?: string | null | undefined;
  longitude?: string | null | undefined;
  numberOfSlots?: number | null | undefined;
  panelNumber?: string | null | undefined;
  pixelHeight?: number | null | undefined;
  pixelWidth?: number | null | undefined;
  premium?: boolean | null | undefined;
  pricingGrade?: string | null | undefined;
  productionRateCard?: string | null | undefined;
  productionRateCardLegacy?: string | null | undefined;
  siteNo?: string | null | undefined;
  sizeCode?: string | null | undefined;
  station?: string | null | undefined;
  status: FrameStatus;
  statusReason?: string | null | undefined;
  tSize?: string | null | undefined;
};

export type FrameFormatInput = {
  formatCode: string;
  sizeGroupCode: string;
  technology: FrameTechnology;
};

export type FrameLocationInput = {
  countryCode: string;
  postcode: string;
  region: string;
  town: string;
};

export type FrameStatus =
  | 'BLOCKED'
  | 'DRAFT'
  | 'LIVE'
  | 'MAINTENANCE'
  | 'PENDING';

export type FrameTechnology =
  | 'CLASSIC'
  | 'DIGITAL';

export type ImportJobStatus =
  | 'AWAITING_UPLOAD'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'EXPIRED'
  | 'FAILED'
  | 'PENDING'
  | 'RUNNING';

export type CreateFrameMutationVariables = Exact<{
  frameId: string | number;
  attributes: FrameAttributesInput;
}>;


export type CreateFrameMutation = { createFrame: { __typename: 'Frame', frameId: string } };

export type FrameForEditQueryVariables = Exact<{
  frameId: string | number;
}>;


export type FrameForEditQuery = { frame: { __typename: 'Frame', frameId: string, versionId: string, current: boolean, attributes: { __typename: 'FrameAttributes', status: string, statusReason: string | null, siteNo: string | null, inventorySiteNo: string | null, panelNumber: string | null, locationId: string | null, environment: string | null, address: string | null, station: string | null, airport: string | null, latitude: string | null, longitude: string | null, distanceToClosestSchool: number | null, sizeCode: string | null, aspectRatioCode: string | null, tSize: string | null, pixelHeight: number | null, pixelWidth: number | null, illuminationTypeId: number | null, numberOfSlots: number | null, impactWeight: string | null, premium: boolean, productionRateCard: string | null, productionRateCardLegacy: string | null, pricingGrade: string | null, location: { __typename: 'FrameLocation', countryCode: string, region: string, town: string, postcode: string } | null, format: { __typename: 'FrameFormat', technology: string, formatCode: string, sizeGroupCode: string } | null } } | null };

export type UpdateFrameMutationVariables = Exact<{
  frameId: string | number;
  expectedVersionId: string;
  attributes: FrameAttributesInput;
}>;


export type UpdateFrameMutation = { updateFrame: { __typename: 'Frame', frameId: string } };

export type ImportJobSummaryFragment = { __typename: 'ImportJob', jobId: string, status: ImportJobStatus, forceOverwrite: boolean, uploadExpiresAt: string, finishedAt: string | null, rowsRead: number, rowsApplied: number, rowsUnchanged: number, rowsRejected: number, failureCode: string | null };

export type CreateImportMutationVariables = Exact<{
  force: boolean;
}>;


export type CreateImportMutation = { createImportJob: { __typename: 'CreateImportJobResult', uploadUrl: string, job: { __typename: 'ImportJob', jobId: string, status: ImportJobStatus, forceOverwrite: boolean, uploadExpiresAt: string, finishedAt: string | null, rowsRead: number, rowsApplied: number, rowsUnchanged: number, rowsRejected: number, failureCode: string | null }, uploadHeaders: Array<{ __typename: 'ImportUploadHeader', name: string, value: string }> } };

export type ImportStatusQueryVariables = Exact<{
  id: string | number;
}>;


export type ImportStatusQuery = { importJob: { __typename: 'ImportJob', jobId: string, status: ImportJobStatus, forceOverwrite: boolean, uploadExpiresAt: string, finishedAt: string | null, rowsRead: number, rowsApplied: number, rowsUnchanged: number, rowsRejected: number, failureCode: string | null } };

export type RowErrorsQueryVariables = Exact<{
  id: string | number;
  page: number;
}>;


export type RowErrorsQuery = { importRowErrors: { __typename: 'ImportRowErrorPage', page: number, hasNext: boolean, items: Array<{ __typename: 'ImportRowError', rowNumber: number, code: string, frameId: string | null, detail: string }> } };

export type FramesQueryVariables = Exact<{
  page: number;
}>;


export type FramesQuery = { frames: { __typename: 'FramePage', page: number, size: number, hasNext: boolean, items: Array<{ __typename: 'Frame', frameId: string, attributes: { __typename: 'FrameAttributes', status: string, environment: string | null, siteNo: string | null, address: string | null, location: { __typename: 'FrameLocation', town: string, postcode: string } | null, format: { __typename: 'FrameFormat', technology: string, formatCode: string } | null } }> } };

export type FrameHistoryQueryVariables = Exact<{
  id: string | number;
}>;


export type FrameHistoryQuery = { frameHistory: Array<{ __typename: 'Frame', versionId: string, validFrom: string, validTo: string | null, current: boolean, changeSource: string | null, closedByChangeSource: string | null, importJobId: string | null, attributes: { __typename: 'FrameAttributes', status: string, statusReason: string | null } }> };

export const ImportJobSummaryFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImportJobSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ImportJob"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"jobId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"forceOverwrite"}},{"kind":"Field","name":{"kind":"Name","value":"uploadExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"rowsRead"}},{"kind":"Field","name":{"kind":"Name","value":"rowsApplied"}},{"kind":"Field","name":{"kind":"Name","value":"rowsUnchanged"}},{"kind":"Field","name":{"kind":"Name","value":"rowsRejected"}},{"kind":"Field","name":{"kind":"Name","value":"failureCode"}}]}}]} as unknown as DocumentNode<ImportJobSummaryFragment, unknown>;
export const CreateFrameDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateFrame"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"frameId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"attributes"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"FrameAttributesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createFrame"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"frameId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"frameId"}}},{"kind":"Argument","name":{"kind":"Name","value":"attributes"},"value":{"kind":"Variable","name":{"kind":"Name","value":"attributes"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frameId"}}]}}]}}]} as unknown as DocumentNode<CreateFrameMutation, CreateFrameMutationVariables>;
export const FrameForEditDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FrameForEdit"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"frameId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frame"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"frameId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"frameId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frameId"}},{"kind":"Field","name":{"kind":"Name","value":"versionId"}},{"kind":"Field","name":{"kind":"Name","value":"current"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"statusReason"}},{"kind":"Field","name":{"kind":"Name","value":"siteNo"}},{"kind":"Field","name":{"kind":"Name","value":"inventorySiteNo"}},{"kind":"Field","name":{"kind":"Name","value":"panelNumber"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"environment"}},{"kind":"Field","name":{"kind":"Name","value":"address"}},{"kind":"Field","name":{"kind":"Name","value":"station"}},{"kind":"Field","name":{"kind":"Name","value":"airport"}},{"kind":"Field","name":{"kind":"Name","value":"latitude"}},{"kind":"Field","name":{"kind":"Name","value":"longitude"}},{"kind":"Field","name":{"kind":"Name","value":"distanceToClosestSchool"}},{"kind":"Field","name":{"kind":"Name","value":"location"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"countryCode"}},{"kind":"Field","name":{"kind":"Name","value":"region"}},{"kind":"Field","name":{"kind":"Name","value":"town"}},{"kind":"Field","name":{"kind":"Name","value":"postcode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"format"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"technology"}},{"kind":"Field","name":{"kind":"Name","value":"formatCode"}},{"kind":"Field","name":{"kind":"Name","value":"sizeGroupCode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sizeCode"}},{"kind":"Field","name":{"kind":"Name","value":"aspectRatioCode"}},{"kind":"Field","name":{"kind":"Name","value":"tSize"}},{"kind":"Field","name":{"kind":"Name","value":"pixelHeight"}},{"kind":"Field","name":{"kind":"Name","value":"pixelWidth"}},{"kind":"Field","name":{"kind":"Name","value":"illuminationTypeId"}},{"kind":"Field","name":{"kind":"Name","value":"numberOfSlots"}},{"kind":"Field","name":{"kind":"Name","value":"impactWeight"}},{"kind":"Field","name":{"kind":"Name","value":"premium"}},{"kind":"Field","name":{"kind":"Name","value":"productionRateCard"}},{"kind":"Field","name":{"kind":"Name","value":"productionRateCardLegacy"}},{"kind":"Field","name":{"kind":"Name","value":"pricingGrade"}}]}}]}}]}}]} as unknown as DocumentNode<FrameForEditQuery, FrameForEditQueryVariables>;
export const UpdateFrameDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateFrame"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"frameId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"expectedVersionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"attributes"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"FrameAttributesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateFrame"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"frameId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"frameId"}}},{"kind":"Argument","name":{"kind":"Name","value":"expectedVersionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"expectedVersionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"attributes"},"value":{"kind":"Variable","name":{"kind":"Name","value":"attributes"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frameId"}}]}}]}}]} as unknown as DocumentNode<UpdateFrameMutation, UpdateFrameMutationVariables>;
export const CreateImportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateImport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"force"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createImportJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mode"},"value":{"kind":"EnumValue","value":"DELTA"}},{"kind":"Argument","name":{"kind":"Name","value":"forceOverwrite"},"value":{"kind":"Variable","name":{"kind":"Name","value":"force"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"job"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImportJobSummary"}}]}},{"kind":"Field","name":{"kind":"Name","value":"uploadUrl"}},{"kind":"Field","name":{"kind":"Name","value":"uploadHeaders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImportJobSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ImportJob"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"jobId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"forceOverwrite"}},{"kind":"Field","name":{"kind":"Name","value":"uploadExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"rowsRead"}},{"kind":"Field","name":{"kind":"Name","value":"rowsApplied"}},{"kind":"Field","name":{"kind":"Name","value":"rowsUnchanged"}},{"kind":"Field","name":{"kind":"Name","value":"rowsRejected"}},{"kind":"Field","name":{"kind":"Name","value":"failureCode"}}]}}]} as unknown as DocumentNode<CreateImportMutation, CreateImportMutationVariables>;
export const ImportStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ImportStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"importJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"jobId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ImportJobSummary"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ImportJobSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ImportJob"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"jobId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"forceOverwrite"}},{"kind":"Field","name":{"kind":"Name","value":"uploadExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"rowsRead"}},{"kind":"Field","name":{"kind":"Name","value":"rowsApplied"}},{"kind":"Field","name":{"kind":"Name","value":"rowsUnchanged"}},{"kind":"Field","name":{"kind":"Name","value":"rowsRejected"}},{"kind":"Field","name":{"kind":"Name","value":"failureCode"}}]}}]} as unknown as DocumentNode<ImportStatusQuery, ImportStatusQueryVariables>;
export const RowErrorsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RowErrors"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"importRowErrors"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"jobId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"size"},"value":{"kind":"IntValue","value":"25"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rowNumber"}},{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"frameId"}},{"kind":"Field","name":{"kind":"Name","value":"detail"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"hasNext"}}]}}]}}]} as unknown as DocumentNode<RowErrorsQuery, RowErrorsQueryVariables>;
export const FramesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Frames"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frames"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"size"},"value":{"kind":"IntValue","value":"25"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"hasNext"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frameId"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"environment"}},{"kind":"Field","name":{"kind":"Name","value":"siteNo"}},{"kind":"Field","name":{"kind":"Name","value":"address"}},{"kind":"Field","name":{"kind":"Name","value":"location"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"town"}},{"kind":"Field","name":{"kind":"Name","value":"postcode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"format"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"technology"}},{"kind":"Field","name":{"kind":"Name","value":"formatCode"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<FramesQuery, FramesQueryVariables>;
export const FrameHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FrameHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"frameHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"frameId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"versionId"}},{"kind":"Field","name":{"kind":"Name","value":"validFrom"}},{"kind":"Field","name":{"kind":"Name","value":"validTo"}},{"kind":"Field","name":{"kind":"Name","value":"current"}},{"kind":"Field","name":{"kind":"Name","value":"changeSource"}},{"kind":"Field","name":{"kind":"Name","value":"closedByChangeSource"}},{"kind":"Field","name":{"kind":"Name","value":"importJobId"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"statusReason"}}]}}]}}]}}]} as unknown as DocumentNode<FrameHistoryQuery, FrameHistoryQueryVariables>;