#include <algorithm>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <vector>

using namespace std;

struct Fragment {
    vector<string> lines;
    int to;
};

int getId(const string& line, map<string, int>& ids) {
    auto entry = ids.emplace(line, static_cast<int>(ids.size()));
    return entry.first->second;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int photos, length;
    if (!(cin >> photos >> length)) return 0;
    cin.ignore(numeric_limits<streamsize>::max(), '\n');

    map<string, int> ids;
    vector<Fragment> fragments(photos);
    vector<vector<int>> outgoing(2 * photos);
    vector<int> balance(2 * photos);
    int start = 0;
    for (int i = 0; i < photos; ++i) {
        auto& lines = fragments[i].lines;
        lines.resize(length);
        for (string& line : lines) {
            getline(cin, line);
            if (!line.empty() && line.back() == '\r') line.pop_back();
        }
        int from = getId(lines.front(), ids);
        int to = getId(lines.back(), ids);
        fragments[i].to = to;
        outgoing[from].push_back(i);
        ++balance[from];
        --balance[to];
        start = from;
    }

    // 一张照片是一条从首行到尾行的边，每张照片恰好用一次。
    for (size_t i = 0; i < ids.size(); ++i) {
        if (balance[i] > 0) start = static_cast<int>(i);
    }
    vector<int> vertices{start}, chosen, order;
    while (!vertices.empty()) {
        int u = vertices.back();
        if (outgoing[u].empty()) {
            vertices.pop_back();
            if (!chosen.empty()) {
                order.push_back(chosen.back());
                chosen.pop_back();
            }
        } else {
            int edge = outgoing[u].back();
            outgoing[u].pop_back();
            chosen.push_back(edge);
            vertices.push_back(fragments[edge].to);
        }
    }

    reverse(order.begin(), order.end());
    for (size_t i = 0; i < order.size(); ++i) {
        const auto& lines = fragments[order[i]].lines;
        for (int j = (i == 0 ? 0 : 1); j < length; ++j) cout << lines[j] << '\n';
    }
}
