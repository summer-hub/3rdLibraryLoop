{{/*
  _helpers.tpl —— 模板辅助
  只放"名字与标签"这类重复片段，不放业务逻辑：
  Helm 模板里的逻辑越少，`helm template` 的输出就越可预测。
*/}}

{{- define "3libloop.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "3libloop.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "3libloop.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "3libloop.labels" -}}
app.kubernetes.io/name: {{ include "3libloop.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "3libloop.image" -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}
