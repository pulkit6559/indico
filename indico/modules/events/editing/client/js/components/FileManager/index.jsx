// This file is part of Indico.
// Copyright (C) 2002 - 2020 CERN
//
// Indico is free software; you can redistribute it and/or
// modify it under the terms of the MIT License; see the
// LICENSE file for more details.

import _ from 'lodash';
import React, {useCallback, useReducer, useContext, useRef, useMemo, useEffect} from 'react';
import globToRegExp from 'glob-to-regexp';
import PropTypes from 'prop-types';
import {fromEvent} from 'file-selector';
import {useDropzone} from 'react-dropzone';
import {Field} from 'react-final-form';
import {Icon, Popup, Segment} from 'semantic-ui-react';
import {TooltipIfTruncated} from 'indico/react/components';
import {Param, Translate} from 'indico/react/i18n';
import {
  FileManagerContext,
  filePropTypes,
  fileTypePropTypes,
  uploadFiles,
  deleteFile,
  mapFileTypes,
} from './util';
import FileList from './FileList';
import Uploads from './Uploads';
import reducer from './reducer';
import * as actions from './actions';
import {getFiles, getUploadedFileUUIDs, getValidationError, isUploading} from './selectors';

import './FileManager.module.scss';

export function Dropzone({
  uploadURL,
  fileType: {id, allowMultipleFiles, files, extensions, filenameTemplate},
}) {
  const dispatch = useContext(FileManagerContext);
  // we only want to modify the existing file if we do not allow multiple files and
  // there is exactly one file that is not in the 'added' state (which would imply
  // a freshly uploaded file which can be simply replaced)
  const fileToReplace =
    !allowMultipleFiles && files.length && files[0].state !== 'added' ? files[0] : null;
  // if we don't allow multiple files and have a file in the added or modified state,
  // that file can always be deleted from the server after the upload
  const fileToDelete =
    !allowMultipleFiles && files.length && ['added', 'modified'].includes(files[0].state)
      ? files[0]
      : null;
  // as far as the user is concerned, they upload a "new" file when there are no files or
  // multiple files are supported for the file type
  const showNewFileIcon = files.length === 0 || allowMultipleFiles;

  const onDropAccepted = useCallback(
    async acceptedFiles => {
      if (!allowMultipleFiles) {
        acceptedFiles = acceptedFiles.splice(0, 1);
      }
      const rv = await uploadFiles(
        fileToReplace ? actions.markModified : actions.markUploaded,
        id,
        acceptedFiles,
        uploadURL,
        dispatch,
        fileToReplace ? fileToReplace.uuid : null
      );
      // only delete if there is a file to delete and the upload of a new file didn't fail
      if (fileToDelete && rv[0] !== null) {
        // we're modifying a freshly uploaded file, so we can get rid of the current one
        deleteFile(fileToDelete.uuid);
      }
    },
    [fileToReplace, fileToDelete, allowMultipleFiles, id, uploadURL, dispatch]
  );

  const {getRootProps, getInputProps, isDragActive} = useDropzone({
    onDropAccepted,
    multiple: allowMultipleFiles,
    accept: extensions.map(ext => `.${ext}`).join(','),
    getFilesFromEvent: async event => {
      const eventFiles = await fromEvent(event);
      if (!filenameTemplate) {
        return eventFiles;
      }

      const templateRe = globToRegExp(filenameTemplate);
      return eventFiles.filter(file => {
        const filename = file.name.slice(0, file.name.indexOf('.'));
        if (!templateRe.test(filename)) {
          dispatch(actions.invalidTemplate(id, file.name));
          return false;
        }
        return true;
      });
    },
  });

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      <div styleName="dropzone" className={isDragActive ? 'active' : ''}>
        <Icon color="grey" size="big" name={showNewFileIcon ? 'plus circle' : 'exchange'} />
      </div>
    </div>
  );
}

Dropzone.propTypes = {
  uploadURL: PropTypes.string.isRequired,
  fileType: PropTypes.shape(fileTypePropTypes).isRequired,
};

function FileType({uploadURL, fileType, uploads}) {
  const ref = useRef(null);
  return (
    <div styleName="file-type">
      <h3>
        {fileType.name}
        {fileType.filenameTemplate !== null && (
          <Popup
            position="bottom center"
            content={
              <Translate>
                Filenames must have the format{' '}
                <Param name="template" value={fileType.filenameTemplate} wrapper={<code />} />
              </Translate>
            }
            trigger={<Icon corner="top right" name="info" />}
          />
        )}
      </h3>
      <TooltipIfTruncated tooltip={fileType.extensions.join(', ')}>
        <ul styleName="file-extensions">
          {fileType.extensions.length !== 0
            ? fileType.extensions.map(ext => <li key={ext}>{ext}</li>)
            : Translate.string('(no extension restrictions)')}
        </ul>
      </TooltipIfTruncated>
      <FileList files={fileType.files} fileType={fileType} uploadURL={uploadURL} />
      {!_.isEmpty(uploads) && <Uploads uploads={uploads} />}
      {!_.isEmpty(fileType.invalidFiles) && (
        <div style={{paddingBottom: '1em'}}>
          {fileType.invalidFiles.map(invalidFile => (
            <Popup
              position="right center"
              key={`${invalidFile}-${Date.now()}`}
              content={
                <Translate>
                  This file does not conform to the filename template{' '}
                  <Param name="template" value={fileType.filenameTemplate} wrapper={<code />} />
                </Translate>
              }
              trigger={
                <Segment>
                  <Icon name="ban" color="orange" />
                  {invalidFile}
                </Segment>
              }
            />
          ))}
        </div>
      )}
      <Dropzone dropzoneRef={ref} fileType={fileType} uploadURL={uploadURL} />
    </div>
  );
}

FileType.propTypes = {
  uploadURL: PropTypes.string.isRequired,
  fileType: PropTypes.shape(fileTypePropTypes).isRequired,
  uploads: PropTypes.objectOf(
    PropTypes.shape({
      file: PropTypes.object.isRequired,
      progress: PropTypes.number,
    })
  ),
};

FileType.defaultProps = {
  uploads: {},
};

export default function FileManager({
  onChange,
  uploadURL,
  fileTypes,
  files,
  finalFieldName,
  pristine,
}) {
  const lastPristineRef = useRef(pristine);
  const _fileTypes = useMemo(() => mapFileTypes(fileTypes, files), [fileTypes, files]);
  const [state, dispatch] = useReducer(reducer, {
    fileTypes: _fileTypes,
    uploads: {},
    isDirty: false,
  });

  useEffect(() => {
    // when the pristine flag changes from false to true, it indicates that the form has
    // been reset (or that the user undid their change, but this is not a problem here).
    // in this case we delete all uploaded files and revert to the initial state, which is
    // based on the value coming from the outside.
    //
    // while this is quite ugly, making the FileManager a fully controlled component is even
    // messier, since we'd need to fetch extra file metadata from the server and keep the
    // external state (value) in sync with the local state, which is not trivial at all.
    if (pristine && !lastPristineRef.current) {
      getUploadedFileUUIDs(state).forEach(uuid => deleteFile(uuid));
      dispatch(actions.reset(_fileTypes));
    }
    lastPristineRef.current = pristine;
  }, [pristine, _fileTypes, state]);

  useEffect(() => {
    if (state.isDirty) {
      onChange(getFiles(state));
      dispatch(actions.clearDirty());
    }
  }, [onChange, state]);

  const uploading = isUploading(state);
  const validationError = getValidationError(state);
  return (
    <div styleName="file-manager-wrapper">
      <div styleName="file-manager">
        <FileManagerContext.Provider value={dispatch}>
          {state.fileTypes.map(fileType => (
            <FileType
              key={fileType.id}
              uploadURL={uploadURL}
              fileType={fileType}
              uploads={state.uploads[fileType.id]}
            />
          ))}
        </FileManagerContext.Provider>
        {!!finalFieldName && uploading && (
          <Field
            name={`_${finalFieldName}_uploading`}
            validate={() => Translate.string('Upload in progress')}
            render={() => null}
          />
        )}
        {!!finalFieldName && validationError && (
          <Field
            name={`_${finalFieldName}_invalid`}
            validate={() => validationError}
            render={() => null}
          />
        )}
      </div>
    </div>
  );
}

FileManager.propTypes = {
  uploadURL: PropTypes.string.isRequired,
  fileTypes: PropTypes.arrayOf(PropTypes.shape(fileTypePropTypes)).isRequired,
  files: PropTypes.arrayOf(PropTypes.shape(filePropTypes)),
  onChange: PropTypes.func.isRequired,
  finalFieldName: PropTypes.string,
  pristine: PropTypes.bool,
};

FileManager.defaultProps = {
  files: [],
  finalFieldName: null,
  pristine: null,
};

export function FinalFileManager({name, uploadURL, fileTypes, ...rest}) {
  // We do not use FinalField here since the file manager is more "standalone"
  // and thus not wrapped in the usual SUI field markup.
  return (
    <Field name={name} isEqual={_.isEqual} format={v => v} parse={v => v} {...rest}>
      {({input, meta: {pristine}}) => (
        <FileManager
          onChange={input.onChange}
          uploadURL={uploadURL}
          fileTypes={fileTypes}
          finalFieldName={input.name}
          files={rest.files}
          pristine={pristine}
        />
      )}
    </Field>
  );
}

FinalFileManager.propTypes = {
  name: PropTypes.string.isRequired,
  uploadURL: PropTypes.string.isRequired,
  fileTypes: PropTypes.arrayOf(PropTypes.shape(fileTypePropTypes)).isRequired,
};
