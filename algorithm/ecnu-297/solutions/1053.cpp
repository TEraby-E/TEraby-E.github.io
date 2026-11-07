#include <algorithm>
#include <iostream>
#include <map>
#include <string>
#include <vector>
using namespace std;

struct State {
    int length = 0;
    int link = -1;
    map<char, int> next;
};

void extend(vector<State> &state, int &last, char ch) {
    int cur = static_cast<int>(state.size());
    state.push_back(State{});
    state[cur].length = state[last].length + 1;
    int p = last;
    while (p != -1 && !state[p].next.count(ch)) {
        state[p].next[ch] = cur;
        p = state[p].link;
    }

    if (p == -1) {
        state[cur].link = 0;
    } else {
        int q = state[p].next[ch];
        if (state[p].length + 1 == state[q].length) {
            state[cur].link = q;
        } else {
            // 克隆保留原状态的出边，拆分长度范围以保持后缀链接正确。
            int clone = static_cast<int>(state.size());
            state.push_back(state[q]);
            state[clone].length = state[p].length + 1;
            while (p != -1) {
                auto edge = state[p].next.find(ch);
                if (edge == state[p].next.end() || edge->second != q) break;
                edge->second = clone;
                p = state[p].link;
            }
            state[q].link = state[cur].link = clone;
        }
    }
    last = cur;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    string a, b;
    if (!getline(cin, a) || !getline(cin, b)) return 0;
    if (!a.empty() && a.back() == '\r') a.pop_back();
    if (!b.empty() && b.back() == '\r') b.pop_back();

    vector<State> state(1);
    state.reserve(2 * a.size() + 1);
    int last = 0;
    for (char ch : a) extend(state, last, ch);

    int p = 0, matched = 0, answer = 0;
    for (char ch : b) {
        // 不能接上当前字符时，沿后缀链接缩短已匹配的连续段。
        while (p && !state[p].next.count(ch)) {
            p = state[p].link;
            matched = state[p].length;
        }
        auto edge = state[p].next.find(ch);
        if (edge == state[p].next.end()) {
            p = matched = 0;
        } else {
            p = edge->second;
            answer = max(answer, ++matched);
        }
    }
    cout << answer << '\n';
    return 0;
}
