#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

using namespace std;

bool visit(int u, const vector<vector<int>>& neighbors, vector<bool>& used,
           vector<int>& path) {
    used[u] = true;
    path.push_back(u);
    if (path.size() == used.size()) return true;
    for (int v : neighbors[u]) {
        if (!used[v] && visit(v, neighbors, used, path)) return true;
    }
    path.pop_back();
    used[u] = false;
    return false;
}

int main() {
    int tests;
    if (!(cin >> tests)) return 0;
    const int dr[] = {1, 2, 2, 1, -1, -2, -2, -1};
    const int dc[] = {2, 1, -1, -2, -2, -1, 1, 2};

    for (int scenario = 1; scenario <= tests; ++scenario) {
        int rows, columns;
        cin >> rows >> columns;
        int n = rows * columns;
        vector<string> name(n);
        vector<vector<int>> neighbors(n);
        vector<int> starts;
        for (int u = 0; u < n; ++u) {
            int row = u % rows, column = u / rows;
            name[u] = string(1, static_cast<char>('A' + column)) + to_string(row + 1);
            starts.push_back(u);
            for (int i = 0; i < 8; ++i) {
                int r = row + dr[i], c = column + dc[i];
                if (r >= 0 && r < rows && c >= 0 && c < columns) {
                    neighbors[u].push_back(c * rows + r);
                }
            }
        }

        auto earlier = [&name](int a, int b) { return name[a] < name[b]; };
        sort(starts.begin(), starts.end(), earlier);
        for (auto& list : neighbors) sort(list.begin(), list.end(), earlier);
        vector<bool> used(n);
        vector<int> path;
        for (int u : starts) {
            if (visit(u, neighbors, used, path)) break;
        }

        cout << "Scenario #" << scenario << ":\n";
        if (path.empty()) cout << "impossible";
        else for (int u : path) cout << name[u];
        cout << "\n\n";
    }
}
