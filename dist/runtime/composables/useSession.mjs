import defu from "defu";
import { callWithNuxt } from "#app";
import { readonly } from "vue";
import { navigateTo, getRequestURL, joinPathToApiURL } from "../utils/url.mjs";
import { _fetch } from "../utils/fetch.mjs";
import { isNonEmptyObject } from "../utils/checkSessionResult.mjs";
import useSessionState from "./useSessionState.mjs";
import { createError, useRequestHeaders, useNuxtApp } from "#imports";
const getCsrfToken = () => {
  let headers = {};
  const { cookie } = useRequestHeaders(["cookie"]);
  if (cookie) {
    headers = { cookie };
  }
  return _fetch("csrf", { headers }).then((response) => response.csrfToken);
};
const signIn = async (provider, options, authorizationParams) => {
  const nuxt = useNuxtApp();
  const joinPathToApiURLWithNuxt = (path) => callWithNuxt(nuxt, joinPathToApiURL, [path]);
  const navigateToWithNuxt = (href) => callWithNuxt(nuxt, navigateTo, [href]);
  const configuredProviders = await getProviders();
  if (!configuredProviders) {
    const errorUrl = await joinPathToApiURLWithNuxt("error");
    return navigateToWithNuxt(errorUrl);
  }
  const { callbackUrl = getRequestURL(), redirect = true } = options ?? {};
  const signinUrl = await joinPathToApiURLWithNuxt("signin");
  const hrefSignInAllProviderPage = `${signinUrl}?${new URLSearchParams({ callbackUrl })}`;
  if (!provider) {
    return navigateToWithNuxt(hrefSignInAllProviderPage);
  }
  const selectedProvider = configuredProviders[provider];
  if (!selectedProvider) {
    return navigateToWithNuxt(hrefSignInAllProviderPage);
  }
  const isCredentials = selectedProvider.type === "credentials";
  const isEmail = selectedProvider.type === "email";
  const isSupportingReturn = isCredentials || isEmail;
  let action = "signin";
  if (isCredentials) {
    action = "callback";
  }
  const csrfToken = await getCsrfToken();
  const data = await _fetch(`${action}/${provider}`, {
    method: "post",
    params: authorizationParams,
    body: {
      ...options,
      csrfToken,
      callbackUrl,
      json: true
    }
  }).catch((error2) => error2.data);
  if (redirect || !isSupportingReturn) {
    const href = data.url ?? callbackUrl;
    return navigateTo(href);
  }
  const error = new URL(data.url).searchParams.get("error");
  await getSession();
  return {
    error,
    status: 200,
    ok: true,
    url: error ? null : data.url
  };
};
const getProviders = () => _fetch("providers");
const getSession = (getSessionOptions) => {
  const callbackUrlFallback = getRequestURL();
  const { required, callbackUrl, onUnauthenticated } = defu(getSessionOptions || {}, {
    required: false,
    callbackUrl: void 0,
    onUnauthenticated: () => signIn(void 0, {
      callbackUrl: getSessionOptions?.callbackUrl || callbackUrlFallback
    })
  });
  const { data, status, loading, lastRefreshedAt } = useSessionState();
  const onError = () => {
    loading.value = false;
  };
  let headers = {};
  const { cookie } = useRequestHeaders(["cookie"]);
  if (cookie) {
    headers = { cookie };
  }
  return _fetch("session", {
    onResponse: ({ response }) => {
      const sessionData = response._data;
      data.value = isNonEmptyObject(sessionData) ? sessionData : null;
      loading.value = false;
      if (required && status.value === "unauthenticated") {
        return onUnauthenticated();
      }
      return sessionData;
    },
    onRequest: ({ options }) => {
      lastRefreshedAt.value = new Date();
      options.params = {
        ...options.params || {},
        callbackUrl: callbackUrl || callbackUrlFallback
      };
    },
    onRequestError: onError,
    onResponseError: onError,
    headers
  });
};
const signOut = async (options) => {
  const { callbackUrl = getRequestURL(), redirect = true } = options ?? {};
  const csrfToken = await getCsrfToken();
  if (!csrfToken) {
    throw createError({ statusCode: 400, statusMessage: "Could not fetch CSRF Token for signing out" });
  }
  const callbackUrlFallback = getRequestURL();
  const signoutData = await _fetch("signout", {
    method: "POST",
    onRequest: ({ options: options2 }) => {
      options2.body = {
        csrfToken,
        callbackUrl: callbackUrl || callbackUrlFallback,
        json: "true"
      };
    }
  }).catch((error) => error.data);
  if (redirect) {
    const url = signoutData.url ?? callbackUrl;
    return navigateTo(url);
  }
  await getSession();
  return signoutData;
};
export default () => {
  const {
    data,
    status,
    lastRefreshedAt
  } = useSessionState();
  const actions = {
    getSession,
    getCsrfToken,
    getProviders,
    signIn,
    signOut
  };
  const getters = {
    status,
    data: readonly(data),
    lastRefreshedAt: readonly(lastRefreshedAt)
  };
  return {
    ...actions,
    ...getters
  };
};
